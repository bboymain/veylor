import { describe, expect, test } from "bun:test";

const migrationPath =
  "supabase/migrations/20260712120000_stage_26_scheduled_quality_maintenance.sql";

describe("Stage 26 scheduled quality maintenance", () => {
  test("uses the correctly named weekly pg_cron job", async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql).toContain("create extension if not exists pg_cron");
    expect(sql).toContain("veylor_model_quality_maintenance_weekly");
    expect(sql).toContain("'15 3 * * 1'");
  });

  test("replaces an existing job before scheduling", async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql).toContain("from cron.job");
    expect(sql).toContain("cron.unschedule");
    expect(sql).toContain("cron.schedule");
  });

  test("runs only the existing private aggregate maintenance function", async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql).toContain("public.run_model_quality_maintenance()");
    expect(sql).not.toContain("shopper_id");
    expect(sql).not.toContain("detected_items");
    expect(sql).not.toContain("corrected_value");
    expect(sql).not.toContain("image_sha256");
  });
});
