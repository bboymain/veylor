import { afterEach, describe, expect, test } from "bun:test";
import {
  acceptanceKey,
  completedAcceptanceStatus,
  requestProductAcceptance,
} from "./product-acceptance";

const ORIGINAL_FETCH = globalThis.fetch;
const SEARCH_ID = "00000000-0000-4000-8000-000000000009";

describe("product acceptance client", () => {
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("uses the dedicated acceptance route and never the click route", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({ accepted: true }), { status: 200 });
    }) as unknown as typeof fetch;

    const accepted = await requestProductAcceptance({
      searchId: SEARCH_ID,
      productUrl: "https://shop.example.com/p/1",
    });

    expect(accepted).toBe(true);
    expect(capturedUrl).toBe("/api/product-accept");
    expect(capturedUrl).not.toContain("product-click");
    expect(capturedInit?.method).toBe("POST");
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      searchId: SEARCH_ID,
      productUrl: "https://shop.example.com/p/1",
    });
  });

  test("returns false for rejected, malformed, and failed responses", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
    expect(
      await requestProductAcceptance({
        searchId: SEARCH_ID,
        productUrl: "https://shop.example.com/p/1",
      }),
    ).toBe(false);

    globalThis.fetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    expect(
      await requestProductAcceptance({
        searchId: SEARCH_ID,
        productUrl: "https://shop.example.com/p/1",
      }),
    ).toBe(false);

    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(
      await requestProductAcceptance({
        searchId: SEARCH_ID,
        productUrl: "https://shop.example.com/p/1",
      }),
    ).toBe(false);
  });

  test("keys state by search and product and confirms only successful requests", () => {
    expect(acceptanceKey(SEARCH_ID, "https://shop.example.com/p/1")).toBe(
      `${SEARCH_ID}:https://shop.example.com/p/1`,
    );
    expect(completedAcceptanceStatus(true)).toBe("confirmed");
    expect(completedAcceptanceStatus(false)).toBe("idle");
  });
});
