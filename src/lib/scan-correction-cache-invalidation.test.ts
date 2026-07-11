import { describe, expect, test } from "bun:test";

describe("Stage 18 correction cache invalidation", () => {
  test("rejects the corrected scan and any verified source scan", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712043000_stage_18_correction_cache_invalidation.sql",
    ).text();

    expect(sql).toContain("cache_status = 'rejected'");
    expect(sql).toContain("cache_verification_evidence = 'user_scan_correction'");
    expect(sql).toContain("cache_verification_evidence = 'derived_scan_correction'");
    expect(sql).toContain("where id = v_cache_source_search_id");
    expect(sql).toContain("cache_verified_at = null");
  });

  test("keeps correction writes scoped to persisted scans and server-only", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712043000_stage_18_correction_cache_invalidation.sql",
    ).text();

    expect(sql).toContain("s.search_type = 'scan'");
    expect(sql).toContain("for update");
    expect(sql).toContain("revoke all on function public.record_scan_correction");
    expect(sql).toContain("to service_role");
    expect(sql).not.toContain("image_data");
  });
});
