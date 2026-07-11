import { describe, expect, test } from "bun:test";
import { parseVerificationRpcRow } from "./product-verification.server";

describe("verification RPC result parsing", () => {
  test("maps an accepted relationship-scoped click", () => {
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

describe("Stage 10 database policy", () => {
  test("requires a persisted search-alternative-product relationship", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260711203000_stage_10_evidence_verification.sql",
    ).text();

    expect(sql).toContain("join public.products p on p.id = a.product_id");
    expect(sql).toContain("join public.searches s on s.id = a.search_id");
    expect(sql).toContain("where a.search_id = p_search_id");
    expect(sql).toContain("p.normalized_product_url = p_normalized_product_url");
  });

  test("promotes scan cache only for successful fingerprinted scans", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260711203000_stage_10_evidence_verification.sql",
    ).text();

    expect(sql).toContain("v_search_type = 'scan'");
    expect(sql).toContain("v_search_status = 'success'");
    expect(sql).toContain("v_image_sha256 is not null");
    expect(sql).toContain("cache_verification_evidence = 'persisted_alternative_click'");
  });

  test("does not use AI confidence as verification evidence", async () => {
    const sql = (
      await Bun.file(
        "supabase/migrations/20260711203000_stage_10_evidence_verification.sql",
      ).text()
    ).toLowerCase();

    expect(sql).not.toContain("classification_confidence");
    expect(sql).not.toContain("brand_confidence");
    expect(sql).not.toContain("confidence >=");
  });
});
