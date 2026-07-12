import { describe, expect, test } from "bun:test";

const MIGRATION = "supabase/migrations/20260712220052_legacy_click_verification_cleanup.sql";

async function migrationSql(): Promise<string> {
  return (await Bun.file(MIGRATION).text()).toLowerCase();
}

function between(sql: string, start: string, end: string): string {
  const afterStart = sql.split(start)[1];
  expect(afterStart).toBeDefined();
  return afterStart!.split(end)[0];
}

describe("legacy click-verification cleanup migration", () => {
  test("captures every targeted row before performing a repair update", async () => {
    const sql = await migrationSql();
    const firstCapture = sql.indexOf("insert into public.legacy_click_verification_repair_audit");
    const firstUpdate = sql.indexOf("update public.products");

    expect(sql).toContain(
      "create table if not exists public.legacy_click_verification_repair_audit",
    );
    expect(sql).toContain("primary key (subject_type, subject_id)");
    expect(sql.match(/insert into public\.legacy_click_verification_repair_audit/g)?.length).toBe(
      3,
    );
    expect(sql).toContain("'verified_by_search_id', p.verified_by_search_id");
    expect(sql).toContain("'verification_evidence', a.verification_evidence");
    expect(sql).toContain("'cache_verified_at', s.cache_verified_at");
    expect(sql).not.toContain("to_jsonb(p)");
    expect(sql).not.toContain("to_jsonb(a)");
    expect(sql).not.toContain("to_jsonb(s)");
    expect(sql).toContain("on conflict (subject_type, subject_id) do nothing");
    expect(firstCapture).toBeGreaterThan(-1);
    expect(firstCapture).toBeLessThan(firstUpdate);
  });

  test("repairs only the retired evidence values and preserves unrelated columns", async () => {
    const sql = await migrationSql();
    const productRepair = between(sql, "update public.products", "update public.alternatives");
    const alternativeRepair = between(sql, "update public.alternatives", "update public.searches");
    const cacheRepair = between(sql, "update public.searches", "drop function if exists");

    expect(productRepair).toContain("verification_status = 'unverified'");
    expect(productRepair).toContain("verified_at = null");
    expect(productRepair).toContain("verification_evidence = null");
    expect(productRepair).toContain("verified_by_search_id = null");
    expect(productRepair).toContain("where verification_evidence = 'user_product_click'");
    expect(productRepair).not.toContain("authenticity_status");

    expect(alternativeRepair).toContain("verification_status = 'unverified'");
    expect(alternativeRepair).toContain("verified_at = null");
    expect(alternativeRepair).toContain("verification_evidence = null");
    expect(alternativeRepair).toContain("where verification_evidence = 'user_product_click'");
    expect(alternativeRepair).not.toContain("accepted_match");
    expect(alternativeRepair).not.toContain("accepted_at");

    expect(cacheRepair).toContain("cache_status = 'unverified'");
    expect(cacheRepair).toContain("cache_verified_at = null");
    expect(cacheRepair).toContain("cache_verification_evidence = null");
    expect(cacheRepair).toContain(
      "where cache_verification_evidence = 'persisted_alternative_click'",
    );
  });

  test("retires the legacy verification RPC without adding a replacement trust path", async () => {
    const sql = await migrationSql();

    expect(sql).toContain(
      "drop function if exists public.verify_product_click(uuid, text, timestamptz)",
    );
    expect(sql).not.toContain("create or replace function public.verify_product_click");
    expect(sql).not.toContain("verification_status = 'verified'");
    expect(sql).not.toContain("cache_status = 'verified'");
  });

  test("keeps the rollback audit server-only", async () => {
    const sql = await migrationSql();

    expect(sql).toContain(
      "alter table public.legacy_click_verification_repair_audit enable row level security",
    );
    expect(sql).toContain(
      "revoke all on table public.legacy_click_verification_repair_audit from public, anon, authenticated",
    );
    expect(sql).toContain(
      "grant select on table public.legacy_click_verification_repair_audit to service_role",
    );
    expect(sql).toContain(
      "revoke all on table public.legacy_click_verification_repair_audit from service_role",
    );
    expect(sql).not.toContain(
      "grant select on table public.legacy_click_verification_repair_audit to anon",
    );
    expect(sql).not.toContain(
      "grant select on table public.legacy_click_verification_repair_audit to authenticated",
    );
  });
});
