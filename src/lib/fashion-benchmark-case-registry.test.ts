import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260712170000_stage_31_fashion_benchmark_case_registry.sql",
);
const sql = readFileSync(migrationPath, "utf8");

describe("Stage 31 fashion benchmark case registry", () => {
  test("uses the exact migration, table, and RPC names", () => {
    expect(migrationPath).toContain(
      "20260712170000_stage_31_fashion_benchmark_case_registry.sql",
    );
    expect(sql).toContain("public.fashion_benchmark_cases");
    expect(sql).toContain("public.upsert_fashion_benchmark_case");
  });

  test("validates stable IDs, private paths, and expected items", () => {
    expect(sql).toContain("fashion_benchmark_cases_case_id_check");
    expect(sql).toContain("fashion_benchmark_cases_path_check");
    expect(sql).toContain("fashion_benchmark_cases_expected_items_check");
    expect(sql).toContain("jsonb_array_length(expected_items) between 1 and 20");
    expect(sql).toContain("jsonb_typeof(item -> 'colors') <> 'array'");
  });

  test("keeps benchmark data private", () => {
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("enable row level security");
    expect(sql).not.toContain("shopper_profiles");
    expect(sql).not.toContain("scan_corrections");
    expect(sql).not.toContain("image_sha256");
  });

  test("stores references and labels, not image bytes", () => {
    expect(sql).toContain("image_storage_path text not null");
    expect(sql).toContain("expected_items jsonb not null");
    expect(sql).not.toContain("bytea");
    expect(sql).not.toContain("base64");
  });
});
