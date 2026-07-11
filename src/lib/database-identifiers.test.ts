import { describe, expect, test } from "bun:test";
import { SearchIdSchema } from "./database-identifiers";

describe("SearchIdSchema", () => {
  test("accepts Supabase UUID identifiers", () => {
    expect(SearchIdSchema.safeParse("550e8400-e29b-41d4-a716-446655440000").success).toBe(true);
  });

  test("rejects empty, arbitrary, and SQL-like values", () => {
    expect(SearchIdSchema.safeParse("").success).toBe(false);
    expect(SearchIdSchema.safeParse("search-123").success).toBe(false);
    expect(SearchIdSchema.safeParse("eq.anything").success).toBe(false);
    expect(
      SearchIdSchema.safeParse("550e8400-e29b-41d4-a716-446655440000&or=(id.neq.x)").success,
    ).toBe(false);
  });
});
