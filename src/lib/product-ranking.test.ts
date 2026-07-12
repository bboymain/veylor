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
    totalAcceptances: 0,
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
        total_acceptances: 3,
      }),
    ).toEqual({
      normalizedProductUrl: "https://example.com/item/1",
      verificationStatus: "verified",
      freshnessStatus: "fresh",
      totalImpressions: 8,
      totalClicks: 2,
      totalAcceptances: 3,
    });
    expect(parseRankingEvidenceRow({ normalized_product_url: null })).toBeNull();
  });

  test("defaults missing acceptance evidence to zero for rollout compatibility", () => {
    expect(
      parseRankingEvidenceRow({
        normalized_product_url: "https://example.com/item/1",
        total_impressions: 8,
        total_clicks: 2,
      })?.totalAcceptances,
    ).toBe(0);
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

  test("accepted matches increase score and outweigh the same number of clicks", () => {
    const baseline = evidence(1, { totalImpressions: 3 });
    const clicked = evidence(1, { totalImpressions: 3, totalClicks: 1 });
    const accepted = evidence(1, { totalImpressions: 3, totalAcceptances: 1 });

    expect(productEvidenceScore(accepted)).toBeGreaterThan(productEvidenceScore(baseline));
    expect(productEvidenceScore(accepted) - productEvidenceScore(baseline)).toBeGreaterThan(
      productEvidenceScore(clicked) - productEvidenceScore(baseline),
    );
  });

  test("zero acceptances preserve the existing click and trust score", () => {
    const existingEvidence = evidence(1, {
      verificationStatus: "verified",
      freshnessStatus: "fresh",
      totalImpressions: 10,
      totalClicks: 2,
      totalAcceptances: 0,
    });

    // Existing score: verified +2, fresh +0.5, smoothed CTR (3 / 14) * 3.
    expect(productEvidenceScore(existingEvidence)).toBe(2.5 + (3 / 14) * 3);
  });

  test("accepted-only and click-only evidence remain unverified", () => {
    const clicked = evidence(1, { totalImpressions: 3, totalClicks: 1 });
    const accepted = evidence(2, { totalAcceptances: 1 });

    expect(productEvidenceScore(clicked)).toBeGreaterThan(0);
    expect(productEvidenceScore(accepted)).toBeGreaterThan(0);
    expect(clicked.verificationStatus).toBe("unverified");
    expect(accepted.verificationStatus).toBe("unverified");
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

  test("large behavioral counts cannot bypass the two-position cap", () => {
    const products = [product(0), product(1), product(2), product(3), product(4), product(5)];
    const evidenceByUrl = new Map([
      [
        "https://example.com/item/5",
        evidence(5, {
          totalImpressions: 1_000_000,
          totalClicks: 1_000_000,
          totalAcceptances: 1_000_000,
        }),
      ],
    ]);

    const ranked = rankProductsWithEvidence(products, evidenceByUrl);
    expect(ranked.findIndex((item) => item.id === "product-5")).toBe(3);
  });
});

describe("accepted-match ranking database policy", () => {
  test("returns accepted matches only as server-side ranking evidence", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712222246_accepted_match_ranking.sql",
    ).text();
    expect(sql).toContain("p.normalized_product_url = any(p_normalized_product_urls)");
    expect(sql).toContain("count(*) filter (where a.clicked)");
    expect(sql).toContain("count(*) filter (where a.accepted_match = true)");
    expect(sql).toContain("total_acceptances bigint");
    expect(sql).toContain(
      "revoke all on function public.get_product_ranking_evidence(text[])\n  from public, anon, authenticated",
    );
    expect(sql).toContain(
      "grant execute on function public.get_product_ranking_evidence(text[])\n  to service_role",
    );
    expect(sql).not.toContain("classification_confidence");
    expect(sql).not.toContain("brand_confidence");
    expect(sql).not.toContain("verification_status =");
    expect(sql).not.toContain("authenticity_status =");
    expect(sql).not.toContain("cache_status =");
    expect(sql).not.toContain("update public.");
    expect(sql).not.toContain("insert into public.");
  });

  test("documents the previous RPC definition used by migration rollback", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712222246_accepted_match_ranking.sql",
    ).text();
    expect(sql).toContain("Rollback restores the Stage 12 definition");
    expect(sql).toContain("supabase migration down --local --last 1");
  });
});
