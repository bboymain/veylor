import { afterEach, describe, expect, test } from "bun:test";
import { logScanAttempt, recordProductClick } from "./search-logging.server";

const ORIGINAL_FETCH = globalThis.fetch;

function setSupabaseEnv() {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
}

function clearSupabaseEnv() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

describe("search-logging", () => {
  afterEach(() => {
    clearSupabaseEnv();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("logs a successful scan attempt and returns the new row id", async () => {
    setSupabaseEnv();
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify([{ id: "row-123" }]), { status: 201 });
    }) as typeof fetch;

    const id = await logScanAttempt({
      status: "success",
      model: "gemini-2.5-flash",
      summary: "Black T-shirt.",
      detectedItems: [],
      primarySearchQuery: "black T-shirt",
    });

    expect(id).toBe("row-123");
    expect(capturedUrl).toBe("https://example.supabase.co/rest/v1/searches");
    expect(capturedInit?.method).toBe("POST");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.apikey).toBe("service-role-secret");
    const body = JSON.parse(String(capturedInit?.body));
    expect(body.status).toBe("success");
    expect(body.model).toBe("gemini-2.5-flash");
    expect(body.primary_search_query).toBe("black T-shirt");
  });

  test("logs a failed scan attempt with a sanitized error message", async () => {
    setSupabaseEnv();
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify([{ id: "row-err" }]), { status: 201 });
    }) as typeof fetch;

    const id = await logScanAttempt({
      status: "error",
      errorMessage: "  Something   went\nwrong  ",
    });

    expect(id).toBe("row-err");
    expect(capturedBody.status).toBe("error");
    expect(capturedBody.error_message).toBe("Something went wrong");
    expect(capturedBody.model).toBeUndefined();
  });

  test("records a product click against an existing search row", async () => {
    setSupabaseEnv();
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    const ok = await recordProductClick({
      searchId: "row-123",
      productUrl: "https://example.com/product",
      productTitle: "Black T-shirt",
      retailer: "SSENSE",
      tier: "authentic",
    });

    expect(ok).toBe(true);
    expect(capturedUrl).toBe("https://example.supabase.co/rest/v1/searches?id=eq.row-123");
    expect(capturedInit?.method).toBe("PATCH");
    const body = JSON.parse(String(capturedInit?.body));
    expect(body.clicked).toBe(true);
    expect(typeof body.clicked_at).toBe("string");
    expect(body.clicked_product_url).toBe("https://example.com/product");
    expect(body.clicked_product_title).toBe("Black T-shirt");
    expect(body.clicked_retailer).toBe("SSENSE");
    expect(body.clicked_tier).toBe("authentic");
  });

  test("returns null/false and never calls fetch when Supabase is not configured", async () => {
    clearSupabaseEnv();
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error("fetch should not be called");
    }) as unknown as typeof fetch;

    const scanId = await logScanAttempt({ status: "error", errorMessage: "boom" });
    const clicked = await recordProductClick({
      searchId: "missing",
      productUrl: "https://example.com",
      productTitle: "Item",
      retailer: "Shop",
      tier: "budget",
    });

    expect(scanId).toBeNull();
    expect(clicked).toBe(false);
    expect(fetchCalled).toBe(false);
  });

  test("swallows database write failures without throwing", async () => {
    setSupabaseEnv();
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const scanId = await logScanAttempt({
      status: "success",
      model: "gemini-2.5-flash",
      summary: "x",
      detectedItems: [],
      primarySearchQuery: "x",
    });
    const clicked = await recordProductClick({
      searchId: "row-1",
      productUrl: "https://example.com",
      productTitle: "Item",
      retailer: "Shop",
      tier: "premium",
    });

    expect(scanId).toBeNull();
    expect(clicked).toBe(false);
  });

  test("swallows a non-ok Supabase response without throwing", async () => {
    setSupabaseEnv();
    globalThis.fetch = (async () =>
      new Response("nope", { status: 500 })) as unknown as typeof fetch;

    const scanId = await logScanAttempt({ status: "error", errorMessage: "boom" });
    expect(scanId).toBeNull();
  });
});
