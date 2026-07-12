import { describe, expect, test } from "bun:test";
import { parseVerificationRpcRow } from "./product-verification.server";

describe("verification RPC result parsing", () => {
  test("preserves the legacy result shape for compatibility", () => {
    expect(
      parseVerificationRpcRow({
        alternative_verified: true,
        product_verified: true,
        search_cache_verified: true,
      }),
    ).toEqual({
      alternativeVerified: true,
      productVerified: true,
      searchCacheVerified: true,
    });
  });

  test("defaults malformed or missing evidence to unverified", () => {
    expect(parseVerificationRpcRow({})).toEqual({
      alternativeVerified: false,
      productVerified: false,
      searchCacheVerified: false,
    });
    expect(
      parseVerificationRpcRow({
        alternative_verified: "true",
        product_verified: 1,
        search_cache_verified: null,
      }),
    ).toEqual({
      alternativeVerified: false,
      productVerified: false,
      searchCacheVerified: false,
    });
  });
});

describe("accepted-match signal database policy", () => {
  test("keeps legacy click handling relationship-scoped", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712205859_accepted_match_signal.sql",
    ).text();

    expect(sql).toContain("join public.products p on p.id = a.product_id");
    expect(sql).toContain("join public.searches s on s.id = a.search_id");
    expect(sql).toContain("where a.search_id = p_search_id");
    expect(sql).toContain("p.normalized_product_url = p_normalized_product_url");
  });

  test("clicks no longer promote identity, authenticity, classification, or cache trust", async () => {
    const sql = (
      await Bun.file("supabase/migrations/20260712205859_accepted_match_signal.sql").text()
    ).toLowerCase();
    const clickFunction = sql.split("create or replace function public.verify_product_click")[1];

    expect(clickFunction).toContain("return query select false, false, false");
    expect(clickFunction).not.toContain("update public.products");
    expect(clickFunction).not.toContain("update public.searches");
    expect(clickFunction).not.toContain("verification_status = 'verified'");
    expect(clickFunction).not.toContain("authenticity_status");
    expect(clickFunction).not.toContain("classification_");
    expect(clickFunction).not.toContain("cache_status = 'verified'");
  });
});
