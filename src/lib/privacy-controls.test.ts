import { describe, expect, test } from "bun:test";
import {
  clearAnonymousShopperCookie,
  resolveAnonymousShopper,
} from "./anonymous-shopper.server";

describe("anonymous shopper privacy controls", () => {
  test("clears the first-party shopper cookie", () => {
    const response = clearAnonymousShopperCookie(new Response(null));
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("veylor_shopper=");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  test("does not accept arbitrary cookie identifiers", () => {
    const shopper = resolveAnonymousShopper(
      new Request("https://veylor.test", {
        headers: { cookie: "veylor_shopper=not-a-valid-profile-id" },
      }),
    );
    expect(shopper.isNew).toBe(true);
    expect(shopper.id).not.toBe("not-a-valid-profile-id");
  });
});

describe("Stage 14 database policy", () => {
  test("deletes only the exact supplied profile and stays service-role only", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712013000_stage_14_privacy_controls.sql",
    ).text();

    expect(sql).toContain("where id = p_profile_id");
    expect(sql).toContain("grant execute on function public.delete_shopper_profile(uuid)");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).not.toContain("delete from public.shopper_profiles;");
  });
});
