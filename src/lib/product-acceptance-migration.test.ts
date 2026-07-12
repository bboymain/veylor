import { describe, expect, test } from "bun:test";

const MIGRATION = "supabase/migrations/20260712205859_accepted_match_signal.sql";

async function migrationSql(): Promise<string> {
  return (await Bun.file(MIGRATION).text()).toLowerCase();
}

describe("accepted match migration", () => {
  test("adds only additive acceptance state with a strict timestamp constraint", async () => {
    const sql = await migrationSql();

    expect(sql).toContain("add column if not exists accepted_match boolean not null default false");
    expect(sql).toContain("add column if not exists accepted_at timestamptz");
    expect(sql).toContain("alternatives_accepted_match_timestamp_check");
    expect(sql).toContain("accepted_match = false and accepted_at is null");
    expect(sql).toContain("accepted_match = true and accepted_at is not null");
    expect(sql).not.toContain("drop table");
    expect(sql).not.toContain("drop column");
    expect(sql).not.toContain("rename column");
    expect(sql).not.toContain("set accepted_match = clicked");
  });

  test("accepts only an existing search, alternative, and normalized product relationship", async () => {
    const sql = await migrationSql();

    expect(sql).toContain("create or replace function public.accept_alternative_match");
    expect(sql).toContain("join public.products p on p.id = a.product_id");
    expect(sql).toContain("join public.searches s on s.id = a.search_id");
    expect(sql).toContain("where a.search_id = p_search_id");
    expect(sql).toContain("p.normalized_product_url = p_normalized_url");
    expect(sql).toContain("for update of a");
    expect(sql).toContain("return false");
    expect(sql).toContain("return true");
  });

  test("updates exactly the acceptance columns and preserves the first timestamp", async () => {
    const sql = await migrationSql();
    const acceptanceFunction = sql.split(
      "create or replace function public.verify_product_click",
    )[0];

    expect(acceptanceFunction).toContain("set accepted_match = true");
    expect(acceptanceFunction).toContain(
      "accepted_at = coalesce(accepted_at, p_accepted_at, now())",
    );
    expect(acceptanceFunction).not.toContain("set clicked =");
    expect(acceptanceFunction).not.toContain("authenticity_status");
    expect(acceptanceFunction).not.toContain("verification_status");
    expect(acceptanceFunction).not.toContain("classification_");
    expect(acceptanceFunction).not.toContain("cache_status");
  });

  test("keeps acceptance callable only by the service role", async () => {
    const sql = await migrationSql();
    const signature = "public.accept_alternative_match(uuid, text, timestamptz)";

    expect(sql).toContain(`revoke all on function ${signature} from public`);
    expect(sql).toContain(`revoke all on function ${signature} from anon`);
    expect(sql).toContain(`revoke all on function ${signature} from authenticated`);
    expect(sql).toContain(`grant execute on function ${signature} to service_role`);
    expect(sql).toContain("alter table public.alternatives enable row level security");
  });

  test("neutralizes legacy click verification while preserving click interest", async () => {
    const sql = await migrationSql();
    const clickFunction = sql.split("create or replace function public.verify_product_click")[1];

    expect(clickFunction).toBeDefined();
    expect(clickFunction).toContain("set clicked = true");
    expect(clickFunction).toContain("clicked_at = coalesce(clicked_at, p_clicked_at)");
    expect(clickFunction).toContain("return query select false, false, false");
    expect(clickFunction).not.toContain("accepted_match");
    expect(clickFunction).not.toContain("update public.products");
    expect(clickFunction).not.toContain("update public.searches");
    expect(clickFunction).not.toContain("verification_status = 'verified'");
    expect(clickFunction).not.toContain("cache_status = 'verified'");
    expect(clickFunction).not.toContain("authenticity_status");
  });
});
