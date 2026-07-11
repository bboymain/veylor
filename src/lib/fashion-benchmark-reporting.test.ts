import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260712190000_stage_33_fashion_benchmark_reporting.sql",
);
const sql = readFileSync(migrationPath, "utf8");

describe("Stage 33 fashion benchmark reporting", () => {
  test("uses the exact migration and RPC names", () => {
    expect(migrationPath).toContain(
      "20260712190000_stage_33_fashion_benchmark_reporting.sql",
    );
    expect(sql).toContain("public.get_fashion_benchmark_run_summary");
    expect(sql).toContain("public.compare_fashion_benchmark_models");
  });

  test("reports field accuracy, latency, and failure signals", () => {
    for (const value of [
      "category_score",
      "color_score",
      "pattern_score",
      "material_score",
      "style_score",
      "visible_brand_score",
      "overall_score",
      "average_response_time_ms",
      "invalid_json_count",
      "hallucinated_brand_count",
    ]) {
      expect(sql).toContain(value);
    }
  });

  test("compares only completed benchmark runs with a minimum sample", () => {
    expect(sql).toContain("r.status = 'completed'");
    expect(sql).toContain("p_minimum_completed_cases integer default 1");
    expect(sql).toContain("having count(*) filter");
    expect(sql).toContain("greatest(p_minimum_completed_cases, 1)");
  });

  test("returns aggregate reports without private benchmark details", () => {
    expect(sql).not.toContain("image_storage_path");
    expect(sql).not.toContain("expected_items");
    expect(sql).not.toContain("case_id");
    expect(sql).not.toContain("raw_model_output");
    expect(sql).not.toContain("shopper_profiles");
    expect(sql).not.toContain("detected_items");
  });

  test("keeps reports service-role-only behind RLS", () => {
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("enable row level security");
  });
});
