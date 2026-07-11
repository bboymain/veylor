import { describe, expect, test } from "bun:test";

const migrationPath =
  "supabase/migrations/20260712100000_stage_24_maintenance_health.sql";

describe("Stage 24 maintenance health policy", () => {
  test("reports stale, never-run, healthy, and attention states", async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql).toContain("'never_run'");
    expect(sql).toContain("'stale'");
    expect(sql).toContain("'attention_required'");
    expect(sql).toContain("'healthy'");
    expect(sql).toContain("p_stale_after interval default interval '8 days'");
  });

  test("summarizes maintenance runs, snapshots, and regression alerts", async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql).toContain("model_quality_maintenance_runs");
    expect(sql).toContain("model_quality_snapshots");
    expect(sql).toContain("model_quality_regressions");
    expect(sql).toContain("unacknowledgedRegressions");
    expect(sql).toContain("latestSnapshotPeriodEndedAt");
  });

  test("keeps operational health aggregate and server-only", async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql).toContain(
      "revoke all on function public.get_model_quality_maintenance_health",
    );
    expect(sql).toContain("to service_role");
    expect(sql).toContain("enable row level security");
    expect(sql).not.toContain("shopper_id");
    expect(sql).not.toContain("image_sha256");
    expect(sql).not.toContain("corrected_value");
    expect(sql).not.toContain("detected_items");
  });
});
