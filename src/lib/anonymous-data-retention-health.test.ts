import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260712160000_stage_30_anonymous_data_retention_health.sql",
);
const sql = readFileSync(migrationPath, "utf8");

describe("Stage 30 anonymous data retention health migration", () => {
  test("uses the exact Stage 30 migration and RPC names", () => {
    expect(migrationPath).toContain(
      "20260712160000_stage_30_anonymous_data_retention_health.sql",
    );
    expect(sql).toContain(
      "public.get_anonymous_data_retention_health",
    );
  });

  test("checks only the exact Veylor retention cron job", () => {
    expect(sql).toContain(
      "veylor_anonymous_data_retention_daily",
    );
    expect(sql).toContain("cron.job_run_details");
    expect(sql).toContain("anonymous_data_retention_runs");
  });

  test("reports every operational health state", () => {
    for (const status of [
      "missing",
      "disabled",
      "failed",
      "waiting_for_first_cron_run",
      "overdue",
      "healthy",
    ]) {
      expect(sql).toContain(`'${status}'`);
    }
  });

  test("returns aggregate retention information only", () => {
    expect(sql).toContain("quotaWindowsDeleted");
    expect(sql).toContain("shopperProfilesDeleted");
    expect(sql).not.toContain("preferred_retailers");
    expect(sql).not.toContain("preferred_tiers");
    expect(sql).not.toContain("detected_items");
    expect(sql).not.toContain("corrected_value");
    expect(sql).not.toContain("previous_value");
    expect(sql).not.toContain("image_sha256");
  });

  test("keeps the health RPC service-role-only", () => {
    expect(sql).toContain(
      "from public, anon, authenticated",
    );
    expect(sql).toContain("to service_role");
    expect(sql).toContain("enable row level security");
  });
});
