import { describe, expect, test } from "bun:test";

describe("Stage 28 scheduled maintenance repair", () => {
  test("uses the exact Stage 28 migration and cron identifiers", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712140000_stage_28_scheduled_maintenance_repair.sql",
    ).text();

    expect(sql).toContain("repair_scheduled_quality_maintenance");
    expect(sql).toContain("veylor_model_quality_maintenance_weekly");
    expect(sql).toContain("15 3 * * 1");
  });

  test("repairs only invalid or duplicate Veylor jobs", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712140000_stage_28_scheduled_maintenance_repair.sql",
    ).text();

    expect(sql).toContain("v_job_count <> 1");
    expect(sql).toContain("v_valid_job_count <> 1");
    expect(sql).toContain("cron.unschedule");
    expect(sql).toContain("cron.schedule");
  });

  test("bootstraps through the existing aggregate maintenance workflow", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712140000_stage_28_scheduled_maintenance_repair.sql",
    ).text();

    expect(sql).toContain("p_run_bootstrap boolean default false");
    expect(sql).toContain("public.run_model_quality_maintenance");
    expect(sql).toContain("p_now - interval '7 days'");
  });

  test("keeps repair access server-only and privacy-safe", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712140000_stage_28_scheduled_maintenance_repair.sql",
    ).text();

    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
    expect(sql).not.toContain("shopper_id");
    expect(sql).not.toContain("detected_items");
    expect(sql).not.toContain("corrected_value");
    expect(sql).not.toContain("image_sha256");
  });
});
