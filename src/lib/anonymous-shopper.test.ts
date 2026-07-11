import { describe, expect, test } from "bun:test";
import type { ProductSearchResult } from "./product-search";
import {
  parseShopperPreferences,
  resolveAnonymousShopper,
  shopperPreferenceScore,
} from "./anonymous-shopper.server";

const product: ProductSearchResult = {
  id: "product-1",
  title: "Black graphic tee",
  imageUrl: "https://example.com/image.jpg",
  productUrl: "https://example.com/item/1",
  price: 30,
  currency: "USD",
  retailer: "Example Shop",
  source: "serpapi",
  tier: "budget",
};

describe("anonymous shopper identity", () => {
  test("reuses a valid first-party UUID cookie", () => {
    const request = new Request("https://veylor.example/api/product-search", {
      headers: {
        cookie: "veylor_shopper=123e4567-e89b-42d3-a456-426614174000",
      },
    });
    expect(resolveAnonymousShopper(request)).toEqual({
      id: "123e4567-e89b-42d3-a456-426614174000",
      isNew: false,
    });
  });

  test("replaces malformed cookies with a new UUID", () => {
    const request = new Request("https://veylor.example/api/product-search", {
      headers: { cookie: "veylor_shopper=not-valid" },
    });
    const shopper = resolveAnonymousShopper(request);
    expect(shopper.isNew).toBe(true);
    expect(shopper.id).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe("shopper preference parsing and scoring", () => {
  test("requires two explicit clicks before preferences affect ranking", () => {
    const preferences = parseShopperPreferences({
      preferred_retailers: { "Example Shop": 1 },
      preferred_tiers: { budget: 1 },
      average_price: 30,
      click_count: 1,
    });
    expect(shopperPreferenceScore(product, preferences)).toBe(0);
  });

  test("bounds the total personalization adjustment", () => {
    const preferences = parseShopperPreferences({
      preferred_retailers: { "Example Shop": 100 },
      preferred_tiers: { budget: 100 },
      average_price: 30,
      click_count: 200,
    });
    expect(shopperPreferenceScore(product, preferences)).toBeLessThanOrEqual(1);
  });

  test("ignores malformed profile maps", () => {
    expect(
      parseShopperPreferences({
        preferred_retailers: "invalid",
        preferred_tiers: null,
        average_price: "30",
        click_count: -2,
      }),
    ).toEqual({
      preferredRetailers: {},
      preferredTiers: {},
      averagePrice: null,
      clickCount: 0,
    });
  });
});

describe("Stage 13 database privacy policy", () => {
  test("learns only from persisted clicked alternatives", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712000000_stage_13_anonymous_preferences.sql",
    ).text();

    expect(sql).toContain("and a.clicked = true");
    expect(sql).toContain("a.search_id = p_search_id");
    expect(sql).toContain("p.normalized_product_url = p_normalized_product_url");
    expect(sql).not.toContain("email");
    expect(sql).not.toContain("ip_address");
    expect(sql).not.toContain("image_sha256");
  });
});
