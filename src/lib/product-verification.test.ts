import { describe, expect, test } from "bun:test";

describe("accepted-match signal database policy", () => {
  test("keeps legacy click handling relationship-scoped", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712205859_accepted_match_signal.sql",
    ).text();

    expect(sql).toContain("join public.products p on p.id = a.product_id");
    expect(sql).toContain("join public.searches s on s.id = a.search_id");
    expect(sql).toContain("where a.search_id = p_search_id");
    expect(sql).toContain("p.normalized_product_url = p_normalized_product_url");
  });

  test("clicks no longer promote identity, authenticity, classification, or cache trust", async () => {
    const sql = (
      await Bun.file("supabase/migrations/20260712205859_accepted_match_signal.sql").text()
    ).toLowerCase();
    const clickFunction = sql.split("create or replace function public.verify_product_click")[1];

    expect(clickFunction).toContain("return query select false, false, false");
    expect(clickFunction).not.toContain("update public.products");
    expect(clickFunction).not.toContain("update public.searches");
    expect(clickFunction).not.toContain("verification_status = 'verified'");
    expect(clickFunction).not.toContain("authenticity_status");
    expect(clickFunction).not.toContain("classification_");
    expect(clickFunction).not.toContain("cache_status = 'verified'");
  });

  test("retires the compatibility RPC after the application moves to interest-only ownership", async () => {
    const sql = (
      await Bun.file(
        "supabase/migrations/20260712220052_legacy_click_verification_cleanup.sql",
      ).text()
    ).toLowerCase();

    expect(sql).toContain(
      "drop function if exists public.verify_product_click(uuid, text, timestamptz)",
    );
  });
});
