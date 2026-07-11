import { describe, expect, test } from "bun:test";

describe("Stage 23 quality maintenance policy", () => {
  test("combines snapshot capture and regression detection", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712090000_stage_23_quality_maintenance_runner.sql",
    ).text();

    expect(sql).toContain("capture_model_quality_snapshot");
    expect(sql).toContain("detect_model_quality_regressions");
    expect(sql).toContain("pg_try_advisory_xact_lock");
    expect(sql).toContain("unique (period_started_at, period_ended_at)");
  });

  test("keeps maintenance data aggregate and server-only", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712090000_stage_23_quality_maintenance_runner.sql",
    ).text();

    expect(sql).toContain("revoke all on function public.run_model_quality_maintenance");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("enable row level security");
    expect(sql).not.toContain("shopper_id");
    expect(sql).not.toContain("image_sha256");
    expect(sql).not.toContain("corrected_value");
    expect(sql).not.toContain("detected_items");
  });

  test("preserves minimum sample and bounded regression settings", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712090000_stage_23_quality_maintenance_runner.sql",
    ).text();

    expect(sql).toContain("p_minimum_sample_size integer default 20");
    expect(sql).toContain("p_regression_threshold numeric default 0.05");
    expect(sql).toContain("p_regression_threshold > 1");
  });
});
