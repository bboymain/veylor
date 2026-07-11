import { describe, expect, test } from "bun:test";
import type { FashionScanItem } from "./fashion-scan";
import {
  createMockProductSearchProvider,
  executeProductSearch,
  normalizeMockProduct,
  type MockProductRecord,
} from "./product-search-provider";
import { groupProductsByTier } from "./product-search";

const item: FashionScanItem = {
  id: "item-1",
  category: "top",
  name: "graphic T-shirt",
  color: "black",
  material: "cotton",
  style: "streetwear",
  pattern: "graphic print",
  visibleBrand: null,
  brandConfidence: 0,
  confidence: 0.92,
  searchQueries: ["black graphic streetwear T-shirt"],
  affordableAlternativeQueries: ["affordable black graphic T-shirt"],
  premiumAlternativeQueries: ["premium black graphic T-shirt"],
};

const rawProduct: MockProductRecord = {
  key: "mock-1",
  name: "  Black graphic tee  ",
  image: "https://example.com/image.jpg",
  url: "https://example.com/product/mock-1",
  priceCents: 4950,
  currencyCode: "usd",
  merchant: "  Example Shop  ",
  tier: "premium",
};

describe("mock product-search provider", () => {
  test("normalizes provider records into the product result contract", () => {
    expect(normalizeMockProduct(rawProduct)).toEqual({
      id: "mock-1",
      title: "Black graphic tee",
      imageUrl: "https://example.com/image.jpg",
      productUrl: "https://example.com/product/mock-1",
      price: 49.5,
      currency: "USD",
      retailer: "Example Shop",
      source: "mock",
      tier: "premium",
    });
  });

  test("groups normalized products by tier", () => {
    const authentic = normalizeMockProduct({ ...rawProduct, key: "auth", tier: "authentic" });
    const premium = normalizeMockProduct(rawProduct);
    const budget = normalizeMockProduct({ ...rawProduct, key: "budget", tier: "budget" });

    const grouped = groupProductsByTier([budget, authentic, premium]);

    expect(grouped.authentic.map((product) => product.id)).toEqual(["auth"]);
    expect(grouped.premium.map((product) => product.id)).toEqual(["mock-1"]);
    expect(grouped.budget.map((product) => product.id)).toEqual(["budget"]);
  });

  test("returns an empty result set without converting it to an error", async () => {
    const provider = createMockProductSearchProvider({ records: [] });
    const response = await executeProductSearch(provider, {
      item,
      searchQueries: item.searchQueries,
    });

    expect(response).toEqual({ products: [] });
  });

  test("normalizes provider failures into a safe error response", async () => {
    const provider = createMockProductSearchProvider({
      error: new Error("Mock provider unavailable"),
    });
    const response = await executeProductSearch(provider, {
      item,
      searchQueries: item.searchQueries,
    });

    expect(response).toEqual({
      error: { code: "PRODUCT_SEARCH_FAILED", message: "Mock provider unavailable" },
    });
  });
});
