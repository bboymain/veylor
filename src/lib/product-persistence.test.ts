import { afterEach, describe, expect, test } from "bun:test";
import { Route as ProductSearchRoute } from "../routes/api/product-search";
import {
  normalizeProductUrl,
  persistProductSearchResults,
  recordAlternativeClick,
} from "./product-persistence.server";
import type { ProductSearchResult } from "./product-search";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_SERPAPI_API_KEY = process.env.SERPAPI_API_KEY;
const ROUTE_SEARCH_ID = "00000000-0000-4000-8000-000000000009";

function setSupabaseEnv() {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
}

function clearSupabaseEnv() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

type CapturedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
};

type MockRoute = {
  match: (url: string, method: string) => boolean;
  respond: (request: CapturedRequest) => Response | Error;
};

/**
 * Installs a fetch mock that records every request and answers from the given
 * routes (first match wins). Unmatched requests get an empty 200 array.
 */
function installFetchMock(routes: MockRoute[]): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const requestUrl = String(url instanceof Request ? url.url : url);
    const method = (init?.method ?? "GET").toUpperCase();
    const request: CapturedRequest = {
      url: requestUrl,
      method,
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [
          key.toLowerCase(),
          value,
        ]),
      ),
      body: init?.body ? String(init.body) : "",
    };
    captured.push(request);
    for (const route of routes) {
      if (route.match(requestUrl, method)) {
        const result = route.respond(request);
        if (result instanceof Error) throw result;
        return result;
      }
    }
    return new Response("[]", { status: 200 });
  }) as unknown as typeof fetch;
  return captured;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status });
}

const gucciBrandRow = {
  id: "brand-gucci",
  normalized_name: "gucci",
  aliases: [],
  market_tier: "luxury",
  verification_status: "verified",
  official_domains: ["gucci.com"],
  trusted_retailers: [],
};

function serpProduct(overrides: Partial<ProductSearchResult>): ProductSearchResult {
  return {
    id: "serpapi-1",
    title: "Gucci GG Marmont shoulder bag",
    imageUrl: "https://images.example.com/1.jpg",
    productUrl: "https://www.gucci.com/us/p/1",
    price: 1200,
    currency: "USD",
    retailer: "Gucci",
    source: "serpapi",
    tier: "authentic",
    ...overrides,
  };
}

const ALLOWED_PRODUCT_COLUMNS = [
  "external_id",
  "source",
  "title",
  "normalized_title",
  "brand_id",
  "detected_brand_name",
  "product_url",
  "normalized_product_url",
  "retailer",
  "retailer_domain",
  "image_url",
  "price",
  "currency",
  "market_tier",
  "authenticity_status",
  "classification_confidence",
  "classification_reason",
  "last_seen_at",
  "updated_at",
];

type RoutePostHandler = (ctx: { request: Request }) => Response | Promise<Response>;

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

const scanItem = {
  id: "item-1",
  category: "bag",
  name: "GG Marmont shoulder bag",
  color: "black",
  material: "leather",
  style: "luxury",
  pattern: null,
  visibleBrand: "Gucci",
  brandConfidence: 0.9,
  confidence: 0.92,
  searchQueries: ["gucci gg marmont shoulder bag"],
  affordableAlternativeQueries: ["quilted leather shoulder bag"],
  premiumAlternativeQueries: ["designer leather shoulder bag"],
};

describe("product-persistence", () => {
  afterEach(() => {
    clearSupabaseEnv();
    if (ORIGINAL_SERPAPI_API_KEY === undefined) {
      delete process.env.SERPAPI_API_KEY;
    } else {
      process.env.SERPAPI_API_KEY = ORIGINAL_SERPAPI_API_KEY;
    }
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("normalizes product URLs deterministically", () => {
    expect(normalizeProductUrl("https://Shop.Example.com/p/1/?utm_source=x&b=2&a=1#frag")).toBe(
      "https://shop.example.com/p/1?a=1&b=2",
    );
    expect(normalizeProductUrl("https://shop.example.com/")).toBe("https://shop.example.com");
    expect(normalizeProductUrl("ftp://shop.example.com/p")).toBeNull();
    expect(normalizeProductUrl("not a url")).toBeNull();
  });

  test("upserts products on (source, normalized_product_url) and dedupes within a batch", async () => {
    setSupabaseEnv();
    const captured = installFetchMock([
      { match: (url) => url.includes("/rest/v1/brands"), respond: () => json([]) },
      { match: (url) => url.includes("/rest/v1/products"), respond: () => json([], 201) },
    ]);

    await persistProductSearchResults({
      searchId: null,
      queryUsed: "gucci bag",
      detectedBrandName: null,
      products: [
        serpProduct({ productUrl: "https://shop.example.com/p/1?utm_source=a" }),
        // Same product modulo tracking params — must not duplicate.
        serpProduct({ id: "serpapi-2", productUrl: "https://shop.example.com/p/1?utm_source=b" }),
        serpProduct({ id: "serpapi-3", productUrl: "https://shop.example.com/p/2" }),
      ],
    });

    const upsert = captured.find((request) => request.url.includes("/rest/v1/products"));
    expect(upsert?.url.includes("on_conflict=source,normalized_product_url")).toBe(true);
    expect(upsert?.headers.prefer?.includes("resolution=merge-duplicates")).toBe(true);
    const rows = JSON.parse(upsert?.body ?? "[]") as Array<Record<string, unknown>>;
    expect(rows.length).toBe(2);
    expect(rows[0].normalized_product_url).toBe("https://shop.example.com/p/1");
    expect(rows[1].normalized_product_url).toBe("https://shop.example.com/p/2");
  });

  test("persisted product rows contain only allowed columns — never raw SerpApi payloads", async () => {
    setSupabaseEnv();
    const captured = installFetchMock([
      { match: (url) => url.includes("/rest/v1/brands"), respond: () => json([]) },
      { match: (url) => url.includes("/rest/v1/products"), respond: () => json([], 201) },
    ]);

    await persistProductSearchResults({
      searchId: null,
      queryUsed: "gucci bag",
      detectedBrandName: "Gucci",
      products: [serpProduct({})],
    });

    const upsert = captured.find((request) => request.url.includes("/rest/v1/products"));
    const rows = JSON.parse(upsert?.body ?? "[]") as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    for (const key of Object.keys(rows[0])) {
      expect(ALLOWED_PRODUCT_COLUMNS.includes(key)).toBe(true);
    }
    expect(upsert?.body.includes("shopping_results")).toBe(false);
    expect(upsert?.body.includes("extracted_price")).toBe(false);
  });

  test("mock fallback results are never persisted", async () => {
    setSupabaseEnv();
    const captured = installFetchMock([]);

    await persistProductSearchResults({
      searchId: "search-1",
      queryUsed: "wool coat",
      detectedBrandName: null,
      products: [
        serpProduct({ source: "mock" }),
        serpProduct({ id: "mock-2", source: "mock", productUrl: "https://mock.example.com/p/2" }),
      ],
    });

    expect(captured.length).toBe(0);
  });

  test("malformed results are not persisted", async () => {
    setSupabaseEnv();
    const captured = installFetchMock([
      { match: (url) => url.includes("/rest/v1/brands"), respond: () => json([]) },
      { match: (url) => url.includes("/rest/v1/products"), respond: () => json([], 201) },
    ]);

    await persistProductSearchResults({
      searchId: null,
      queryUsed: "bag",
      detectedBrandName: null,
      products: [
        serpProduct({ productUrl: "javascript:alert(1)" }),
        serpProduct({ id: "serpapi-2", title: "   " }),
        serpProduct({ id: "serpapi-3", productUrl: "https://shop.example.com/ok" }),
      ],
    });

    const upsert = captured.find((request) => request.url.includes("/rest/v1/products"));
    const rows = JSON.parse(upsert?.body ?? "[]") as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(rows[0].normalized_product_url).toBe("https://shop.example.com/ok");
  });

  test("creates alternatives preserving result order with 1-based ranks", async () => {
    setSupabaseEnv();
    const captured = installFetchMock([
      { match: (url) => url.includes("/rest/v1/brands"), respond: () => json([gucciBrandRow]) },
      {
        match: (url) => url.includes("/rest/v1/products"),
        respond: () =>
          json(
            [
              { id: "prod-1", normalized_product_url: "https://www.gucci.com/us/p/1" },
              { id: "prod-2", normalized_product_url: "https://shop.example.com/p/2" },
              { id: "prod-3", normalized_product_url: "https://shop.example.com/p/3" },
            ],
            201,
          ),
      },
      { match: (url) => url.includes("/rest/v1/alternatives"), respond: () => json([], 201) },
    ]);

    await persistProductSearchResults({
      searchId: "search-9",
      queryUsed: "gucci gg marmont shoulder bag",
      detectedBrandName: "Gucci",
      products: [
        serpProduct({}),
        serpProduct({
          id: "serpapi-2",
          title: "Quilted bag",
          productUrl: "https://shop.example.com/p/2",
        }),
        serpProduct({
          id: "serpapi-3",
          title: "Leather bag",
          productUrl: "https://shop.example.com/p/3",
        }),
      ],
    });

    const insert = captured.find(
      (request) =>
        request.url.includes("/rest/v1/alternatives?on_conflict=") && request.method === "POST",
    );
    expect(insert?.url.includes("on_conflict=search_id,product_id")).toBe(true);
    expect(insert?.headers.prefer?.includes("resolution=ignore-duplicates")).toBe(true);
    const rows = JSON.parse(insert?.body ?? "[]") as Array<Record<string, unknown>>;
    expect(rows.map((row) => row.product_id)).toEqual(["prod-1", "prod-2", "prod-3"]);
    expect(rows.map((row) => row.result_rank)).toEqual([1, 2, 3]);
    expect(rows.every((row) => row.search_id === "search-9")).toBe(true);
    expect(rows.every((row) => row.query_used === "gucci gg marmont shoulder bag")).toBe(true);
    // Official-domain product is classified verified; unrelated titles unknown.
    expect(rows[0].classification_label).toBe("verified");
    expect(rows[1].classification_label).toBe("unknown");
  });

  test("re-running persistence cannot reset historical alternative signal data", async () => {
    setSupabaseEnv();
    const captured = installFetchMock([
      { match: (url) => url.includes("/rest/v1/brands"), respond: () => json([]) },
      {
        match: (url) => url.includes("/rest/v1/products"),
        respond: () =>
          json([{ id: "prod-1", normalized_product_url: "https://www.gucci.com/us/p/1" }], 201),
      },
      { match: (url) => url.includes("/rest/v1/alternatives"), respond: () => json([], 201) },
    ]);
    const input = {
      searchId: "search-9",
      queryUsed: "gucci bag",
      detectedBrandName: "Gucci",
      products: [serpProduct({})],
    };

    await persistProductSearchResults(input);
    await persistProductSearchResults(input);

    const inserts = captured.filter(
      (request) => request.url.includes("/rest/v1/alternatives") && request.method === "POST",
    );
    expect(inserts.length).toBe(2);
    for (const insert of inserts) {
      expect(insert.headers.prefer).toContain("resolution=ignore-duplicates");
      const rows = JSON.parse(insert.body) as Array<Record<string, unknown>>;
      expect(rows.length).toBe(1);
      expect(rows[0].clicked).toBeUndefined();
      expect(rows[0].clicked_at).toBeUndefined();
      expect(rows[0].accepted_match).toBeUndefined();
      expect(rows[0].accepted_at).toBeUndefined();
    }
  });

  test("does not create alternatives when there is no searchId", async () => {
    setSupabaseEnv();
    const captured = installFetchMock([
      { match: (url) => url.includes("/rest/v1/brands"), respond: () => json([]) },
      { match: (url) => url.includes("/rest/v1/products"), respond: () => json([], 201) },
    ]);

    await persistProductSearchResults({
      searchId: null,
      queryUsed: "bag",
      detectedBrandName: null,
      products: [serpProduct({})],
    });

    expect(captured.some((request) => request.url.includes("/rest/v1/products"))).toBe(true);
    expect(captured.some((request) => request.url.includes("/rest/v1/alternatives"))).toBe(false);
  });

  test("persistence writes never contain the service key or provider request URLs", async () => {
    setSupabaseEnv();
    const captured = installFetchMock([
      { match: (url) => url.includes("/rest/v1/brands"), respond: () => json([gucciBrandRow]) },
      {
        match: (url) => url.includes("/rest/v1/products"),
        respond: () =>
          json([{ id: "prod-1", normalized_product_url: "https://www.gucci.com/us/p/1" }], 201),
      },
      { match: (url) => url.includes("/rest/v1/alternatives"), respond: () => json([], 201) },
    ]);

    await persistProductSearchResults({
      searchId: "search-1",
      queryUsed: "gucci bag",
      detectedBrandName: "Gucci",
      products: [serpProduct({})],
    });

    for (const request of captured) {
      expect(request.body.includes("service-role-secret")).toBe(false);
      expect(request.body.includes("api_key")).toBe(false);
      expect(request.body.includes("serpapi.com")).toBe(false);
      expect(request.url.includes("service-role-secret")).toBe(false);
    }
  });

  test("is a silent no-op when Supabase is not configured", async () => {
    clearSupabaseEnv();
    const captured = installFetchMock([]);

    await persistProductSearchResults({
      searchId: "search-1",
      queryUsed: "bag",
      detectedBrandName: null,
      products: [serpProduct({})],
    });

    expect(captured.length).toBe(0);
  });

  test("upsert failures are swallowed and never throw", async () => {
    setSupabaseEnv();
    installFetchMock([
      { match: (url) => url.includes("/rest/v1/brands"), respond: () => json([]) },
      {
        match: (url) => url.includes("/rest/v1/products"),
        respond: () => new Error("network down"),
      },
    ]);

    await persistProductSearchResults({
      searchId: "search-1",
      queryUsed: "bag",
      detectedBrandName: null,
      products: [serpProduct({})],
    });
    // Reaching this line without throwing is the assertion.
    expect(true).toBe(true);
  });

  test("a persistence failure does not break the product-search response", async () => {
    setSupabaseEnv();
    process.env.SERPAPI_API_KEY = "test-serpapi-key";
    installFetchMock([
      {
        match: (url) => url.includes("serpapi.com"),
        respond: () =>
          json({
            shopping_results: [
              {
                position: 1,
                title: "Gucci GG Marmont shoulder bag",
                link: "https://www.gucci.com/us/p/1?utm_source=google",
                source: "Gucci",
                extracted_price: 1200,
                thumbnail: "https://images.example.com/1.jpg",
              },
              {
                position: 2,
                title: "Leather shoulder bag",
                link: "https://shop.example.com/p/2",
                source: "Example Shop",
                extracted_price: 80,
              },
            ],
          }),
      },
      { match: (url) => url.includes("/rest/v1/brands"), respond: () => new Error("db down") },
      {
        match: (url) => url.includes("/rest/v1/products"),
        respond: () => new Error("db down"),
      },
    ]);

    const response = await postHandlerOf(ProductSearchRoute)(
      jsonRequest({ item: scanItem, searchQueries: scanItem.searchQueries, searchId: "scan-7" }),
    );
    const payload = (await response.json()) as { products?: unknown[] };

    expect(response.status).toBe(200);
    expect(Array.isArray(payload.products)).toBe(true);
    expect(payload.products?.length).toBe(2);
  });

  test("scan-shaped searches persist candidates and link alternatives to the scan searchId", async () => {
    setSupabaseEnv();
    process.env.SERPAPI_API_KEY = "test-serpapi-key";
    const captured = installFetchMock([
      {
        match: (url) => url.includes("serpapi.com"),
        respond: () =>
          json({
            shopping_results: [
              {
                position: 1,
                title: "Gucci GG Marmont shoulder bag",
                link: "https://www.gucci.com/us/p/1?utm_source=google",
                source: "Gucci",
                extracted_price: 1200,
              },
              {
                position: 2,
                title: "Leather shoulder bag",
                link: "https://shop.example.com/p/2",
                source: "Example Shop",
                extracted_price: 80,
              },
            ],
          }),
      },
      { match: (url) => url.includes("/rest/v1/brands"), respond: () => json([gucciBrandRow]) },
      {
        match: (url) => url.includes("/rest/v1/products"),
        respond: () =>
          json(
            [
              { id: "prod-cheap", normalized_product_url: "https://shop.example.com/p/2" },
              { id: "prod-gucci", normalized_product_url: "https://www.gucci.com/us/p/1" },
            ],
            201,
          ),
      },
      { match: (url) => url.includes("/rest/v1/alternatives"), respond: () => json([], 201) },
    ]);

    const response = await postHandlerOf(ProductSearchRoute)(
      jsonRequest({
        item: scanItem,
        searchQueries: scanItem.searchQueries,
        searchId: ROUTE_SEARCH_ID,
      }),
    );

    expect(response.status).toBe(200);
    // No duplicate searches row is logged for scan-shaped input.
    expect(captured.some((request) => request.url.includes("/rest/v1/searches"))).toBe(false);

    const upsert = captured.find((request) => request.url.includes("/rest/v1/products"));
    const productRows = JSON.parse(upsert?.body ?? "[]") as Array<Record<string, unknown>>;
    expect(productRows.length).toBe(2);
    const gucciRow = productRows.find(
      (row) => row.normalized_product_url === "https://www.gucci.com/us/p/1",
    );
    expect(gucciRow?.brand_id).toBe("brand-gucci");
    expect(gucciRow?.market_tier).toBe("luxury");
    expect(gucciRow?.authenticity_status).toBe("verified");

    const insert = captured.find(
      (request) =>
        request.url.includes("/rest/v1/alternatives?on_conflict=") && request.method === "POST",
    );
    const altRows = JSON.parse(insert?.body ?? "[]") as Array<Record<string, unknown>>;
    expect(altRows.length).toBe(2);
    expect(altRows.every((row) => row.search_id === ROUTE_SEARCH_ID)).toBe(true);
    // Display order (price-sorted by the temporary tiers) is preserved as rank.
    expect(altRows.map((row) => row.result_rank)).toEqual([1, 2]);
    expect(altRows.map((row) => row.product_id)).toEqual(["prod-cheap", "prod-gucci"]);
  });

  test("alternative clicks patch only interest fields and never write product identity", async () => {
    setSupabaseEnv();
    const captured = installFetchMock([
      {
        match: (url, method) => url.includes("/rest/v1/products") && method === "GET",
        respond: () => json([{ id: "prod-gucci" }]),
      },
      {
        match: (url, method) => url.includes("/rest/v1/alternatives") && method === "PATCH",
        respond: () => new Response(null, { status: 204 }),
      },
    ]);

    const ok = await recordAlternativeClick({
      searchId: ROUTE_SEARCH_ID,
      productUrl: "https://www.gucci.com/us/p/1?utm_source=google",
    });
    expect(ok).toBe(true);

    const lookup = captured.find(
      (request) => request.url.includes("/rest/v1/products") && request.method === "GET",
    );
    expect(lookup?.url.includes(encodeURIComponent("https://www.gucci.com/us/p/1"))).toBe(true);

    const altPatch = captured.find(
      (request) => request.url.includes("/rest/v1/alternatives") && request.method === "PATCH",
    );
    expect(altPatch?.url.includes(`search_id=eq.${ROUTE_SEARCH_ID}`)).toBe(true);
    expect(altPatch?.url.includes("product_id=in.(prod-gucci)")).toBe(true);
    const patchBody = JSON.parse(altPatch?.body ?? "{}") as Record<string, unknown>;
    expect(Object.keys(patchBody).sort()).toEqual(["clicked", "clicked_at"]);
    expect(patchBody.clicked).toBe(true);
    expect(typeof patchBody.clicked_at).toBe("string");

    const identityWrites = captured.filter(
      (request) =>
        (request.url.includes("/rest/v1/products") || request.url.includes("/rest/v1/brands")) &&
        request.method !== "GET",
    );
    expect(identityWrites).toEqual([]);
  });

  test("alternative click failures never throw and report false", async () => {
    setSupabaseEnv();
    installFetchMock([
      {
        match: (url) => url.includes("/rest/v1/products"),
        respond: () => new Error("network down"),
      },
    ]);

    const ok = await recordAlternativeClick({
      searchId: "search-9",
      productUrl: "https://www.gucci.com/us/p/1",
    });
    expect(ok).toBe(false);
  });
});
