import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const phase7MigrationPath = fileURLToPath(
  new URL(
    "../../supabase/migrations/20260711143000_create_brand_intelligence_tables.sql",
    import.meta.url,
  ),
);
const stage8MigrationPath = fileURLToPath(
  new URL(
    "../../supabase/migrations/20260711180000_stage_8_align_database_foundation.sql",
    import.meta.url,
  ),
);

function readMigration(path: string): string {
  return readFileSync(path, "utf8");
}

describe("four-table database foundation", () => {
  test("Phase 7 creates brands, products, and alternatives linked to searches", () => {
    const sql = readMigration(phase7MigrationPath);

    expect(sql).toContain("create table if not exists public.brands");
    expect(sql).toContain("create table if not exists public.products");
    expect(sql).toContain("create table if not exists public.alternatives");
    expect(sql).toContain("references public.brands (id) on delete set null");
    expect(sql).toContain("references public.searches (id) on delete cascade");
    expect(sql).toContain("references public.products (id) on delete cascade");
  });

  test("Stage 8 is additive and preserves legacy search data", () => {
    const sql = readMigration(stage8MigrationPath).toLowerCase();

    expect(sql).toContain("alter table public.searches");
    expect(sql).toContain("add column if not exists search_type");
    expect(sql).toContain("add column if not exists updated_at");
    expect(sql).not.toMatch(/\bdrop\s+table\b/);
    expect(sql).not.toMatch(/\btruncate\b/);
    expect(sql).not.toMatch(/\bdelete\s+from\b/);
  });

  test("Stage 8 validates relationships and keeps every table server-only", () => {
    const sql = readMigration(stage8MigrationPath);

    expect(sql).toContain("foreign key (brand_id) references public.brands (id)");
    expect(sql).toContain("foreign key (search_id) references public.searches (id)");
    expect(sql).toContain("foreign key (product_id) references public.products (id)");

    for (const table of ["searches", "brands", "products", "alternatives"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }

    expect(sql).not.toMatch(/create\s+policy/i);
  });

  test("mutable tables receive updated_at triggers", () => {
    const sql = readMigration(stage8MigrationPath);

    for (const table of ["searches", "brands", "products", "alternatives"]) {
      expect(sql).toContain(`create trigger ${table}_set_updated_at`);
    }
  });
});
