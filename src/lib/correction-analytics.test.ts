import { describe, expect, test } from "bun:test";

describe("Stage 20 correction analytics policy", () => {
  test("returns aggregate model and field metrics only", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712060000_stage_20_correction_analytics.sql",
    ).text();

    expect(sql).toContain("get_scan_correction_analytics");
    expect(sql).toContain("count(*) filter (where es.correction_count > 0)");
    expect(sql).toContain("group by es.model");
    expect(sql).toContain("group by sc.field_name");
    expect(sql).toContain("averageCorrectionsPerCorrectedScan");
    expect(sql).toContain("p_since");
  });

  test("keeps analytics service-role-only and excludes row-level payloads", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712060000_stage_20_correction_analytics.sql",
    ).text();

    expect(sql).toContain(
      "revoke all on function public.get_scan_correction_analytics(timestamptz)",
    );
    expect(sql).toContain("to service_role");
    expect(sql).toContain("enable row level security");
    expect(sql).not.toContain("previous_value");
    expect(sql).not.toContain("corrected_value");
    expect(sql).not.toContain("detected_items");
    expect(sql).not.toContain("image_sha256");
    expect(sql).not.toContain("profile_id");
  });
});
