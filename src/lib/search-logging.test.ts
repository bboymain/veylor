import { afterEach, describe, expect, test } from "bun:test";
import { Route as ProductClickRoute } from "../routes/api/product-click";
import { Route as ProductSearchRoute } from "../routes/api/product-search";
import type { FashionScanItem } from "./fashion-scan";
import {
  logManualSearchAttempt,
  logScanAttempt,
  MANUAL_SEARCH_MODEL,
  recordProductClick,
} from "./search-logging.server";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_SERPAPI_API_KEY = process.env.SERPAPI_API_KEY;

function setSupabaseEnv() {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
}

function clearSupabaseEnv() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

type RoutePostHandler = (ctx: { request: Request }) => Response | Promise<Response>;

/** Pulls a route's POST handler out so tests can invoke it directly. */
function postHandlerOf(route: unknown): RoutePostHandler {
  const handler = (route as { options?: { server?: { handlers?: { POST?: unknown } } } }).options
    ?.server?.handlers?.POST;
  if (typeof handler !== "function") throw new Error("Route has no POST handler");
  return handler as RoutePostHandler;
}

function jsonRequest(payload: unknown): { request: Request } {
  return {
    request: new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  };
}

const scanItem: FashionScanItem = {
  id: "item-1",
  category: "top",
  name: "graphic T-shirt",
  color: "black",
  material: "cotton",
  style: "streetwear",
  pattern: "graphic print",
  visibleBrand: null,
  brandConfidence: 0,
  confidence: 0.92,
  searchQueries: ["black graphic streetwear T-shirt"],
  affordableAlternativeQueries: ["affordable black graphic T-shirt"],
  premiumAlternativeQueries: ["premium black graphic T-shirt"],
};

describe("search-logging", () => {
  afterEach(() => {
    clearSupabaseEnv();
    if (ORIGINAL_SERPAPI_API_KEY === undefined) {
      delete process.env.SERPAPI_API_KEY;
    } else {
      process.env.SERPAPI_API_KEY = ORIGINAL_SERPAPI_API_KEY;
    }
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

  test("logs a successful manual search as one manual-model row and returns its id", async () => {
    setSupabaseEnv();
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify([{ id: "manual-row-1" }]), { status: 201 });
    }) as typeof fetch;

    const id = await logManualSearchAttempt({
      status: "success",
      query: "black Wu-Tang graphic T-shirt",
    });

    expect(id).toBe("manual-row-1");
    expect(capturedUrl).toBe("https://example.supabase.co/rest/v1/searches");
    expect(capturedInit?.method).toBe("POST");
    const body = JSON.parse(String(capturedInit?.body));
    expect(body.status).toBe("success");
    expect(body.model).toBe(MANUAL_SEARCH_MODEL);
    expect(body.summary).toBe("Manual product search");
    expect(body.primary_search_query).toBe("black Wu-Tang graphic T-shirt");
    expect(body.error_message).toBeUndefined();
    expect(body.detected_items).toBeUndefined();
  });

  test("logs a failed manual search with a sanitized error message and the query", async () => {
    setSupabaseEnv();
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify([{ id: "manual-row-err" }]), { status: 201 });
    }) as typeof fetch;

    const id = await logManualSearchAttempt({
      status: "error",
      query: "red leather jacket",
      errorMessage: "  The shopping   search\nfailed.  ",
    });

    expect(id).toBe("manual-row-err");
    expect(capturedBody.status).toBe("error");
    expect(capturedBody.model).toBe(MANUAL_SEARCH_MODEL);
    expect(capturedBody.primary_search_query).toBe("red leather jacket");
    expect(capturedBody.error_message).toBe("The shopping search failed.");
  });

  test("manual-search row payload never contains the service-role key", async () => {
    setSupabaseEnv();
    let capturedRawBody = "";
    globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
      capturedRawBody = String(init?.body);
      return new Response(JSON.stringify([{ id: "manual-row-2" }]), { status: 201 });
    }) as typeof fetch;

    await logManualSearchAttempt({
      status: "error",
      query: "denim jacket",
      errorMessage: "The shopping search service could not be reached.",
    });

    expect(capturedRawBody.includes("service-role-secret")).toBe(false);
    expect(capturedRawBody.includes("api_key")).toBe(false);
    expect(capturedRawBody.includes("serpapi.com")).toBe(false);
  });

  test("manual-search logging failure returns null and never throws", async () => {
    setSupabaseEnv();
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const id = await logManualSearchAttempt({ status: "success", query: "wool coat" });
    expect(id).toBeNull();
  });

  test("manual-search logging is a silent no-op when Supabase is not configured", async () => {
    clearSupabaseEnv();
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error("fetch should not be called");
    }) as unknown as typeof fetch;

    const id = await logManualSearchAttempt({ status: "success", query: "wool coat" });
    expect(id).toBeNull();
    expect(fetchCalled).toBe(false);
  });

  test("rejects invalid manual queries without logging a row", async () => {
    setSupabaseEnv();
    // No SERPAPI_API_KEY → mock provider, so any fetch would be a Supabase write.
    delete process.env.SERPAPI_API_KEY;
    let supabaseWrites = 0;
    globalThis.fetch = (async () => {
      supabaseWrites += 1;
      return new Response(JSON.stringify([{ id: "should-not-exist" }]), { status: 201 });
    }) as unknown as typeof fetch;

    const response = await postHandlerOf(ProductSearchRoute)(jsonRequest({ query: "   " }));

    expect(response.status).toBe(400);
    expect(supabaseWrites).toBe(0);
  });

  test("image-based product searches do not create a duplicate logging row", async () => {
    setSupabaseEnv();
    delete process.env.SERPAPI_API_KEY;
    let supabaseWrites = 0;
    globalThis.fetch = (async () => {
      supabaseWrites += 1;
      return new Response(JSON.stringify([{ id: "should-not-exist" }]), { status: 201 });
    }) as unknown as typeof fetch;

    const response = await postHandlerOf(ProductSearchRoute)(
      jsonRequest({ item: scanItem, searchQueries: scanItem.searchQueries }),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(supabaseWrites).toBe(0);
    expect("searchId" in payload).toBe(false);
  });

  test("manual clicks update the manual row returned by the product-search route", async () => {
    setSupabaseEnv();
    delete process.env.SERPAPI_API_KEY;
    let insertBody: Record<string, unknown> = {};
    let patchUrl = "";
    let patchMethod = "";
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        insertBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify([{ id: "manual-row-9" }]), { status: 201 });
      }
      patchUrl = String(url);
      patchMethod = init?.method ?? "";
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    const searchResponse = await postHandlerOf(ProductSearchRoute)(
      jsonRequest({ query: "  black wool coat  " }),
    );
    const searchPayload = (await searchResponse.json()) as { searchId?: unknown };

    expect(searchResponse.status).toBe(200);
    expect(searchPayload.searchId).toBe("manual-row-9");
    expect(insertBody.model).toBe(MANUAL_SEARCH_MODEL);
    expect(insertBody.primary_search_query).toBe("black wool coat");

    const clickResponse = await postHandlerOf(ProductClickRoute)(
      jsonRequest({
        searchId: String(searchPayload.searchId),
        productUrl: "https://example.com/product/1",
        productTitle: "Black wool coat",
        retailer: "Example Shop",
        tier: "authentic",
      }),
    );
    const clickPayload = (await clickResponse.json()) as { success?: unknown };

    expect(clickResponse.status).toBe(200);
    expect(clickPayload.success).toBe(true);
    expect(patchMethod).toBe("PATCH");
    expect(patchUrl).toBe("https://example.supabase.co/rest/v1/searches?id=eq.manual-row-9");
  });
});
