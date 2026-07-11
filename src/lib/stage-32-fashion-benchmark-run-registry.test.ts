import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260712180000_stage_32_fashion_benchmark_run_registry.sql",
);
const sql = readFileSync(migrationPath, "utf8");

describe("Stage 32 fashion benchmark run registry", () => {
  test("uses the exact migration, table, and RPC names", () => {
    expect(migrationPath).toContain(
      "20260712180000_stage_32_fashion_benchmark_run_registry.sql",
    );
    expect(sql).toContain("public.fashion_benchmark_runs");
    expect(sql).toContain("public.fashion_benchmark_results");
    expect(sql).toContain("public.start_fashion_benchmark_run");
    expect(sql).toContain("public.record_fashion_benchmark_result");
    expect(sql).toContain("public.complete_fashion_benchmark_run");
  });

  test("records deterministic field scores and failure signals", () => {
    for (const field of [
      "category_score",
      "color_score",
      "pattern_score",
      "material_score",
      "style_score",
      "visible_brand_score",
      "overall_score",
      "response_time_ms",
      "invalid_json",
      "hallucinated_brand",
      "failure_code",
    ]) {
      expect(sql).toContain(field);
    }
    expect(sql).toContain("between 0 and 1");
  });

  test("keeps benchmark data separated from production and private", () => {
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("enable row level security");
    expect(sql).not.toContain("shopper_profiles");
    expect(sql).not.toContain("scan_corrections");
    expect(sql).not.toContain("detected_items");
    expect(sql).not.toContain("image_sha256");
  });

  test("links results to curated benchmark cases", () => {
    expect(sql).toContain("references public.fashion_benchmark_cases(case_id)");
    expect(sql).toContain("unique (run_id, case_id)");
    expect(sql).toContain("where active = true");
  });
});
