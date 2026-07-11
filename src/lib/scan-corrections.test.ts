import { describe, expect, test } from "bun:test";
import {
  isNoopCorrection,
  normalizeCorrectionValue,
  SCAN_CORRECTION_FIELDS,
} from "./scan-corrections.server";

describe("scan correction normalization", () => {
  test("trims values and treats empty text as null", () => {
    expect(normalizeCorrectionValue("  olive green  ")).toBe("olive green");
    expect(normalizeCorrectionValue("   ")).toBeNull();
    expect(normalizeCorrectionValue(null)).toBeNull();
  });

  test("detects no-op edits after normalization", () => {
    expect(isNoopCorrection(" navy ", "navy")).toBe(true);
    expect(isNoopCorrection(null, " ")).toBe(true);
    expect(isNoopCorrection("navy", "black")).toBe(false);
  });

  test("allows only editable fashion fields", () => {
    expect(SCAN_CORRECTION_FIELDS).toEqual([
      "name",
      "category",
      "color",
      "style",
      "material",
      "pattern",
      "visibleBrand",
    ]);
  });
});

describe("Stage 16 database policy", () => {
  test("requires a persisted scan and keeps the table server-only", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712033000_stage_16_scan_corrections.sql",
    ).text();
    expect(sql).toContain("s.search_type = 'scan'");
    expect(sql).toContain("coalesce(p_previous_value, '') = coalesce(p_corrected_value, '')");
    expect(sql).toContain("revoke all on function public.record_scan_correction");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("enable row level security");
    expect(sql).not.toContain("image_data");
  });
});
