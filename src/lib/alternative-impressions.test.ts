import { describe, expect, test } from "bun:test";
import {
  normalizedDisplayedProductUrls,
  parseImpressionRpcRow,
} from "./alternative-impressions.server";

const baseProduct = {
  id: "product-1",
  title: "Black graphic shirt",
  price: 24.99,
  currency: "USD",
  retailer: "Example",
  imageUrl: "https://example.com/image.jpg",
  productUrl: "https://example.com/item/1?utm_source=test",
  source: "serpapi" as const,
  tier: "budget" as const,
};

describe("displayed product normalization", () => {
  test("keeps only unique persisted SerpApi product URLs", () => {
    expect(
      normalizedDisplayedProductUrls([
        baseProduct,
        { ...baseProduct, id: "duplicate", productUrl: "https://example.com/item/1" },
        { ...baseProduct, id: "mock", source: "mock" as const },
      ]),
    ).toEqual(["https://example.com/item/1"]);
  });

  test("drops malformed URLs", () => {
    expect(
      normalizedDisplayedProductUrls([{ ...baseProduct, productUrl: "not-a-url" }]),
    ).toEqual([]);
  });
});

describe("impression RPC result parsing", () => {
  test("accepts non-negative numeric counts", () => {
    expect(
      parseImpressionRpcRow({ alternatives_updated: 4, products_refreshed: 3 }),
    ).toEqual({ alternativesUpdated: 4, productsRefreshed: 3 });
  });

  test("defaults malformed counts to zero", () => {
    expect(
      parseImpressionRpcRow({ alternatives_updated: -1, products_refreshed: "3" }),
    ).toEqual({ alternativesUpdated: 0, productsRefreshed: 0 });
  });
});

describe("Stage 11 database policy", () => {
  test("updates only alternatives attached to the supplied search", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260711213000_stage_11_impression_freshness.sql",
    ).text();

    expect(sql).toContain("where a.search_id = p_search_id");
    expect(sql).toContain("and a.product_id = any(p_product_ids)");
    expect(sql).toContain("impression_count = a.impression_count + 1");
  });

  test("records freshness without changing provider rank", async () => {
    const sql = (
      await Bun.file(
        "supabase/migrations/20260711213000_stage_11_impression_freshness.sql",
      ).text()
    ).toLowerCase();

    expect(sql).toContain("freshness_status = 'fresh'");
    expect(sql).not.toContain("result_rank =");
    expect(sql).not.toContain("clicked_at desc");
  });
});
