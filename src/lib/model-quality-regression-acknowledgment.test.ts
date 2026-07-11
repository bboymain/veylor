import { describe, expect, test } from "bun:test";

const migrationPath =
  "supabase/migrations/20260712110000_stage_25_regression_acknowledgment.sql";

describe("Stage 25 regression acknowledgment policy", () => {
  test("keeps alerts while marking reviewed regressions", async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql).toContain("acknowledge_model_quality_regression");
    expect(sql).toContain("acknowledged_at = p_acknowledged_at");
    expect(sql).toContain("and acknowledged_at is null");
    expect(sql).not.toContain("delete from public.model_quality_regressions");
  });

  test("supports one alert and all open alerts for a model", async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql).toContain("p_regression_id uuid");
    expect(sql).toContain("acknowledge_model_quality_regressions_for_model");
    expect(sql).toContain("where model = v_model");
    expect(sql).toContain("returns integer");
  });

  test("makes regression identifiers actionable but server-only", async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql).toContain("regression_id uuid");
    expect(sql).toContain("mqr.id as regression_id");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("enable row level security");
  });

  test("does not introduce private scan or shopper data", async () => {
    const sql = await Bun.file(migrationPath).text();

    expect(sql).not.toContain("shopper_id");
    expect(sql).not.toContain("image_sha256");
    expect(sql).not.toContain("corrected_value");
    expect(sql).not.toContain("detected_items");
  });
});
