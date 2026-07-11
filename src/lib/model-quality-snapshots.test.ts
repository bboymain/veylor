import { describe, expect, test } from "bun:test";

describe("Stage 21 model quality snapshot policy", () => {
  test("stores aggregates only and requires a minimum sample size", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712070000_stage_21_model_quality_snapshots.sql",
    ).text();

    expect(sql).toContain("count(*) >= p_minimum_sample_size");
    expect(sql).toContain("sample_usable");
    expect(sql).toContain("s.search_type = 'scan'");
    expect(sql).toContain("s.status = 'success'");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("enable row level security");

    expect(sql).not.toContain("shopper_profile");
    expect(sql).not.toContain("detected_items jsonb");
    expect(sql).not.toContain("previous_value text");
    expect(sql).not.toContain("corrected_value text");
    expect(sql).not.toContain("image_sha256 text");
  });

  test("comparison output can exclude undersized samples", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712070000_stage_21_model_quality_snapshots.sql",
    ).text();

    expect(sql).toContain("p_only_usable boolean default true");
    expect(sql).toContain("not p_only_usable or mqs.sample_usable");
    expect(sql).toContain("period_ended_at desc, mqs.model asc");
  });
});
