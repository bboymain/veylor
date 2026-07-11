import { describe, expect, test } from "bun:test";

const migrationPath =
  "supabase/migrations/20260712130000_stage_27_scheduled_maintenance_health.sql";

describe("Stage 27 scheduled maintenance health", () => {
  test("checks the correctly named weekly cron job", async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql).toContain("veylor_model_quality_maintenance_weekly");
    expect(sql).toContain("from cron.job");
    expect(sql).toContain("from cron.job_run_details");
  });

  test("reports operational states without exposing cron messages", async () => {
    const sql = await Bun.file(migrationPath).text();

    for (const state of [
      "missing",
      "disabled",
      "failed",
      "waiting_for_first_run",
      "overdue",
      "healthy",
    ]) {
      expect(sql).toContain(`'${state}'`);
    }

    expect(sql).not.toContain("return_message");
  });

  test("keeps scheduler health service-role-only and privacy-safe", async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql).toContain(
      "public.get_scheduled_quality_maintenance_health",
    );
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
    expect(sql).not.toContain("shopper_id");
    expect(sql).not.toContain("detected_items");
    expect(sql).not.toContain("corrected_value");
    expect(sql).not.toContain("image_sha256");
  });
});
