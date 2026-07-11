import { describe, expect, test } from "bun:test";

describe("Stage 19 correction materialization", () => {
  test("requires the corrected item to exist in the persisted scan", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712050000_stage_19_materialize_scan_corrections.sql",
    ).text();

    expect(sql).toContain("jsonb_typeof(v_detected_items) <> 'array'");
    expect(sql).toContain("item ->> 'id' = v_normalized_item_id");
    expect(sql).toContain("return false;");
  });

  test("updates only the matching item while preserving array order", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712050000_stage_19_materialize_scan_corrections.sql",
    ).text();

    expect(sql).toContain("jsonb_set(");
    expect(sql).toContain("array[p_field_name]");
    expect(sql).toContain("order by item.ordinality");
    expect(sql).toContain("correction_count = s.correction_count + 1");
    expect(sql).toContain("last_corrected_at = p_created_at");
  });

  test("retains correction history and cache invalidation", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712050000_stage_19_materialize_scan_corrections.sql",
    ).text();

    expect(sql).toContain("insert into public.scan_corrections");
    expect(sql).toContain("cache_status = 'rejected'");
    expect(sql).toContain("cache_verification_evidence = 'user_scan_correction'");
    expect(sql).toContain("cache_verification_evidence = 'derived_scan_correction'");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("enable row level security");
  });
});
