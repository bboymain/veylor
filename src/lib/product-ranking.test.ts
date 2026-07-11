import { describe, expect, test } from "bun:test";
import type { ProductSearchResult } from "./product-search";
import {
  parseRankingEvidenceRow,
  productEvidenceScore,
  rankProductsWithEvidence,
  type ProductRankingEvidence,
} from "./product-ranking.server";

function product(index: number): ProductSearchResult {
  return {
    id: `product-${index}`,
    title: `Product ${index}`,
    imageUrl: `https://example.com/${index}.jpg`,
    productUrl: `https://example.com/item/${index}`,
    price: 20 + index,
    currency: "USD",
    retailer: "Example",
    source: "serpapi",
    tier: "budget",
  };
}

function evidence(
  index: number,
  overrides: Partial<ProductRankingEvidence> = {},
): ProductRankingEvidence {
  return {
    normalizedProductUrl: `https://example.com/item/${index}`,
    verificationStatus: "unverified",
    freshnessStatus: "unknown",
    totalImpressions: 0,
    totalClicks: 0,
    ...overrides,
  };
}

describe("ranking evidence parsing", () => {
  test("accepts supported evidence and rejects malformed rows", () => {
    expect(
      parseRankingEvidenceRow({
        normalized_product_url: "https://example.com/item/1",
        verification_status: "verified",
        freshness_status: "fresh",
        total_impressions: 8,
        total_clicks: 2,
      }),
    ).toEqual({
      normalizedProductUrl: "https://example.com/item/1",
      verificationStatus: "verified",
      freshnessStatus: "fresh",
      totalImpressions: 8,
      totalClicks: 2,
    });
    expect(parseRankingEvidenceRow({ normalized_product_url: null })).toBeNull();
  });
});

describe("evidence scoring", () => {
  test("does not use CTR before the minimum impression floor", () => {
    const noClicks = evidence(1, { totalImpressions: 2, totalClicks: 0 });
    const oneClick = evidence(1, { totalImpressions: 2, totalClicks: 1 });
    expect(productEvidenceScore(oneClick)).toBe(productEvidenceScore(noClicks));
  });

  test("rejected and unavailable products receive strong penalties", () => {
    const trusted = evidence(1, {
      verificationStatus: "verified",
      freshnessStatus: "fresh",
    });
    const unsafe = evidence(1, {
      verificationStatus: "rejected",
      freshnessStatus: "unavailable",
    });
    expect(productEvidenceScore(trusted)).toBeGreaterThan(productEvidenceScore(unsafe));
  });
});

describe("bounded product ranking", () => {
  test("preserves provider order when there is no evidence", () => {
    const products = [product(0), product(1), product(2), product(3)];
    expect(rankProductsWithEvidence(products, new Map()).map((item) => item.id)).toEqual(
      products.map((item) => item.id),
    );
  });

  test("never moves a result upward by more than two positions", () => {
    const products = [product(0), product(1), product(2), product(3), product(4)];
    const evidenceByUrl = new Map([
      [
        "https://example.com/item/4",
        evidence(4, {
          verificationStatus: "verified",
          freshnessStatus: "fresh",
          totalImpressions: 10,
          totalClicks: 8,
        }),
      ],
    ]);
    const ranked = rankProductsWithEvidence(products, evidenceByUrl);
    expect(ranked.findIndex((item) => item.id === "product-4")).toBeGreaterThanOrEqual(2);
  });

  test("preserves provider order for equal evidence scores", () => {
    const products = [product(0), product(1), product(2)];
    const evidenceByUrl = new Map([
      ["https://example.com/item/0", evidence(0, { freshnessStatus: "fresh" })],
      ["https://example.com/item/1", evidence(1, { freshnessStatus: "fresh" })],
    ]);
    expect(rankProductsWithEvidence(products, evidenceByUrl).map((item) => item.id)).toEqual(
      products.map((item) => item.id),
    );
  });
});

describe("Stage 12 database policy", () => {
  test("returns evidence only for explicitly requested normalized URLs", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260711230000_stage_12_evidence_ranking.sql",
    ).text();
    expect(sql).toContain("p.normalized_product_url = any(p_normalized_product_urls)");
    expect(sql).toContain("count(*) filter (where a.clicked)");
    expect(sql).not.toContain("classification_confidence");
    expect(sql).not.toContain("brand_confidence");
  });
});
