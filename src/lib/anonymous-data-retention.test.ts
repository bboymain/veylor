import { describe, expect, test } from "bun:test";

describe("Stage 29 anonymous data retention", () => {
  test("uses the exact Stage 29 names and schedule", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712150000_stage_29_anonymous_data_retention.sql",
    ).text();

    expect(sql).toContain("run_anonymous_data_retention");
    expect(sql).toContain("veylor_anonymous_data_retention_daily");
    expect(sql).toContain("20 4 * * *");
  });

  test("applies bounded quota and profile retention defaults", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712150000_stage_29_anonymous_data_retention.sql",
    ).text();

    expect(sql).toContain("interval '2 days'");
    expect(sql).toContain("interval '180 days'");
    expect(sql).toContain("delete from public.api_quota_windows");
    expect(sql).toContain("delete from public.shopper_profiles");
  });

  test("records aggregate cleanup counts without copying private data", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712150000_stage_29_anonymous_data_retention.sql",
    ).text();

    expect(sql).toContain("anonymous_data_retention_runs");
    expect(sql).toContain("quota_windows_deleted");
    expect(sql).toContain("shopper_profiles_deleted");
    expect(sql).not.toContain("preferred_retailers jsonb");
    expect(sql).not.toContain("preferred_tiers jsonb");
    expect(sql).not.toContain("detected_items");
    expect(sql).not.toContain("corrected_value");
    expect(sql).not.toContain("image_sha256");
  });

  test("keeps retention server-only behind RLS", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712150000_stage_29_anonymous_data_retention.sql",
    ).text();

    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("cron.unschedule");
    expect(sql).toContain("cron.schedule");
  });
});
