import { describe, expect, test } from "bun:test";

describe("Stage 22 model regression policy", () => {
  test("compares only usable aggregate snapshots and keeps access server-only", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712080000_stage_22_model_regression_detection.sql",
    ).text();

    expect(sql).toContain("mqs.sample_usable = true");
    expect(sql).toContain("lag(mqs.correction_rate)");
    expect(sql).toContain(">= p_minimum_rate_increase");
    expect(sql).toContain("unique (previous_snapshot_id, current_snapshot_id)");
    expect(sql).toContain("revoke all on function public.detect_model_quality_regressions");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("enable row level security");
  });

  test("stores no raw scan or shopper content", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712080000_stage_22_model_regression_detection.sql",
    ).text();

    expect(sql).not.toContain("detected_items");
    expect(sql).not.toContain("previous_value");
    expect(sql).not.toContain("corrected_value");
    expect(sql).not.toContain("image_sha256");
    expect(sql).not.toContain("profile_id");
  });

  test("does not automatically switch models or retrain", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712080000_stage_22_model_regression_detection.sql",
    ).text();

    expect(sql).not.toContain("active_model");
    expect(sql).not.toContain("update public.model");
    expect(sql).not.toContain("retrain");
  });
});
