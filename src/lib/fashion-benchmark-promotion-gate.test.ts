import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260712200000_stage_34_fashion_benchmark_promotion_gate.sql",
);
const sql = readFileSync(migrationPath, "utf8");

describe("Stage 34 fashion benchmark promotion gate", () => {
  test("uses the exact migration, table, and RPC names", () => {
    expect(migrationPath).toContain(
      "20260712200000_stage_34_fashion_benchmark_promotion_gate.sql",
    );
    expect(sql).toContain("public.fashion_benchmark_baselines");
    expect(sql).toContain("public.set_fashion_benchmark_baseline");
    expect(sql).toContain("public.evaluate_fashion_benchmark_promotion");
  });

  test("returns explicit promotion decisions", () => {
    for (const decision of ["promote", "hold", "insufficient_data"]) {
      expect(sql).toContain(`'${decision}'`);
    }
  });

  test("checks quality, latency, invalid JSON, and brand hallucinations", () => {
    expect(sql).toContain("p_minimum_score_improvement");
    expect(sql).toContain("p_maximum_latency_regression_ratio");
    expect(sql).toContain("p_maximum_invalid_json_rate");
    expect(sql).toContain("p_maximum_brand_hallucination_rate");
    expect(sql).toContain("p_minimum_completed_cases integer default 20");
  });

  test("never changes the production model automatically", () => {
    expect(sql).toContain("'productionModelChanged', false");
    expect(sql).not.toContain("update public.production");
    expect(sql).not.toContain("alter system");
  });

  test("keeps baseline and evaluation private", () => {
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("enable row level security");
    expect(sql).not.toContain("image_storage_path");
    expect(sql).not.toContain("expected_items");
    expect(sql).not.toContain("shopper_profiles");
  });
});
