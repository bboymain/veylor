import { describe, expect, test } from "bun:test";
import {
  brandMatches,
  classifyProduct,
  normalizeBrandName,
  normalizeProductTitle,
  retailerDomainFromUrl,
  type BrandRecord,
  type ClassificationInput,
} from "./product-classification.server";

const gucci: BrandRecord = {
  id: "brand-gucci",
  normalizedName: "gucci",
  aliases: [],
  marketTier: "luxury",
  verificationStatus: "verified",
  officialDomains: ["gucci.com"],
  trustedRetailers: ["Nordstrom", "ssense.com"],
};

const levis: BrandRecord = {
  id: "brand-levis",
  normalizedName: "levis",
  aliases: ["levistrauss"],
  marketTier: "mid_market",
  verificationStatus: "verified",
  officialDomains: ["levi.com"],
  trustedRetailers: [],
};

function input(overrides: Partial<ClassificationInput>): ClassificationInput {
  return {
    title: "Gucci GG Marmont shoulder bag",
    detectedBrandName: "Gucci",
    retailer: "Some Shop",
    retailerDomain: "some-shop.com",
    price: 100,
    productUrl: "https://some-shop.com/p/1",
    brand: gucci,
    ...overrides,
  };
}

describe("brand-name normalization", () => {
  test("lowercases, strips punctuation and diacritics", () => {
    expect(normalizeBrandName("Levi's")).toBe("levis");
    expect(normalizeBrandName(" H&M ")).toBe("hm");
    expect(normalizeBrandName("Comme des Garçons")).toBe("commedesgarcons");
    expect(normalizeBrandName("GUCCI")).toBe("gucci");
    expect(normalizeBrandName("Levi Strauss & Co.")).toBe("levistraussco");
    expect(normalizeBrandName("  ")).toBe("");
  });

  test("normalizes titles by lowercasing and collapsing whitespace", () => {
    expect(normalizeProductTitle("  Gucci  GG   Marmont Bag ")).toBe("gucci gg marmont bag");
  });

  test("extracts retailer domains without www", () => {
    expect(retailerDomainFromUrl("https://www.gucci.com/us/p/1")).toBe("gucci.com");
    expect(retailerDomainFromUrl("https://shop.example.co.uk/x")).toBe("shop.example.co.uk");
    expect(retailerDomainFromUrl("not a url")).toBeNull();
  });
});

describe("brand matching", () => {
  test("matches the exact normalized brand name", () => {
    expect(brandMatches(gucci, normalizeBrandName("GUCCI"))).toBe(true);
    expect(brandMatches(gucci, normalizeBrandName("Prada"))).toBe(false);
    expect(brandMatches(gucci, "")).toBe(false);
  });

  test("matches aliases after normalization", () => {
    expect(brandMatches(levis, normalizeBrandName("Levi Strauss"))).toBe(true);
    expect(brandMatches(levis, normalizeBrandName("Levi's"))).toBe(true);
  });
});

describe("classification rules", () => {
  test("exact brand match associates the product and adopts the brand market tier", () => {
    const result = classifyProduct(input({}));
    expect(result.brandId).toBe("brand-gucci");
    expect(result.marketTier).toBe("luxury");
    // Brand match alone is not authenticity evidence.
    expect(result.authenticityStatus).toBe("unknown");
    expect(result.confidence).toBe(0.6);
  });

  test("alias match associates the product with the brand row", () => {
    const result = classifyProduct(
      input({
        title: "Levi Strauss 501 original jeans",
        detectedBrandName: "Levi Strauss",
        brand: levis,
      }),
    );
    expect(result.brandId).toBe("brand-levis");
    expect(result.marketTier).toBe("mid_market");
    expect(result.authenticityStatus).toBe("unknown");
  });

  test("unknown brand stays fully unknown", () => {
    const result = classifyProduct(input({ brand: null }));
    expect(result.brandId).toBeNull();
    expect(result.marketTier).toBe("unknown");
    expect(result.authenticityStatus).toBe("unknown");
    expect(result.confidence).toBe(0);
  });

  test("a detected name that does not match the brand row stays unknown", () => {
    const result = classifyProduct(input({ detectedBrandName: "Prada" }));
    expect(result.brandId).toBeNull();
    expect(result.authenticityStatus).toBe("unknown");
  });

  test("brand absent from the product title prevents association", () => {
    const result = classifyProduct(input({ title: "Leather shoulder bag" }));
    expect(result.brandId).toBeNull();
    expect(result.marketTier).toBe("unknown");
    expect(result.authenticityStatus).toBe("unknown");
    expect(result.reason).toBe("Brand not evident in product title.");
  });

  test("trusted retailer name raises authenticity to likely", () => {
    const result = classifyProduct(input({ retailer: "Nordstrom" }));
    expect(result.authenticityStatus).toBe("likely");
    expect(result.confidence).toBe(0.8);
  });

  test("trusted retailer domain raises authenticity to likely", () => {
    const result = classifyProduct(
      input({ retailer: null, retailerDomain: "www.ssense.com".replace(/^www\./, "") }),
    );
    expect(result.authenticityStatus).toBe("likely");
  });

  test("official brand domain plus verified brand record yields verified", () => {
    const result = classifyProduct(
      input({ retailerDomain: "gucci.com", productUrl: "https://www.gucci.com/us/p/1" }),
    );
    expect(result.authenticityStatus).toBe("verified");
    expect(result.confidence).toBe(0.95);
    expect(result.reason).toBe("Sold via official brand domain.");
  });

  test("official-domain subdomains also count as official", () => {
    const result = classifyProduct(input({ retailerDomain: "shop.gucci.com" }));
    expect(result.authenticityStatus).toBe("verified");
  });

  test("official domain on an unverified brand record yields likely, not verified", () => {
    const unverified: BrandRecord = { ...gucci, verificationStatus: "unverified" };
    const result = classifyProduct(input({ brand: unverified, retailerDomain: "gucci.com" }));
    expect(result.authenticityStatus).toBe("likely");
    expect(result.confidence).toBe(0.75);
  });

  test("price alone never produces verified authenticity", () => {
    // Expensive with no brand evidence: unknown.
    const noBrand = classifyProduct(input({ brand: null, price: 25000 }));
    expect(noBrand.authenticityStatus).toBe("unknown");

    // Expensive with a brand match but no retailer evidence: still unknown.
    const brandOnly = classifyProduct(input({ price: 25000 }));
    expect(brandOnly.authenticityStatus).toBe("unknown");

    // Identical evidence with wildly different prices classifies identically.
    const cheap = classifyProduct(input({ price: 3 }));
    const expensive = classifyProduct(input({ price: 99999 }));
    const priceless = classifyProduct(input({ price: null }));
    expect(cheap).toEqual(brandOnly);
    expect(expensive).toEqual(brandOnly);
    expect(priceless).toEqual(brandOnly);
  });

  test("unknown retailer remains unknown even with a brand match", () => {
    const result = classifyProduct(
      input({ retailer: null, retailerDomain: "random-marketplace.example" }),
    );
    expect(result.brandId).toBe("brand-gucci");
    expect(result.authenticityStatus).toBe("unknown");
    expect(result.reason).toBe("Brand matched; no retailer evidence.");
  });

  test("reasons are short and contain no URLs or secrets", () => {
    const results = [
      classifyProduct(input({})),
      classifyProduct(input({ brand: null })),
      classifyProduct(input({ retailerDomain: "gucci.com" })),
      classifyProduct(input({ retailer: "Nordstrom" })),
    ];
    for (const result of results) {
      expect(result.reason.length).toBeLessThan(80);
      expect(result.reason.includes("http")).toBe(false);
      expect(result.reason.includes("key")).toBe(false);
    }
  });
});
