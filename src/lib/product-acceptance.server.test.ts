import { afterEach, describe, expect, test } from "bun:test";
import { Route as ProductAcceptRoute } from "../routes/api/product-accept";
import { acceptProductMatch } from "./product-acceptance.server";

const ORIGINAL_FETCH = globalThis.fetch;
const SEARCH_ID = "00000000-0000-4000-8000-000000000009";

function setSupabaseEnv() {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
}

function clearSupabaseEnv() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

type RoutePostHandler = (ctx: { request: Request }) => Response | Promise<Response>;

function postHandlerOf(route: unknown): RoutePostHandler {
  const handler = (route as { options?: { server?: { handlers?: { POST?: unknown } } } }).options
    ?.server?.handlers?.POST;
  if (typeof handler !== "function") throw new Error("Route has no POST handler");
  return handler as RoutePostHandler;
}

function jsonRequest(payload: unknown): { request: Request } {
  return {
    request: new Request("http://localhost/api/product-accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  };
}

describe("product acceptance server owner", () => {
  afterEach(() => {
    clearSupabaseEnv();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("calls only the acceptance RPC with a normalized relationship key", async () => {
    setSupabaseEnv();
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response("true", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await acceptProductMatch({
      searchId: SEARCH_ID,
      productUrl: "https://Shop.Example.com/p/1/?utm_source=feed#details",
    });

    expect(result).toBe("accepted");
    expect(capturedUrl).toBe("https://example.supabase.co/rest/v1/rpc/accept_alternative_match");
    expect(capturedInit?.method).toBe("POST");
    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["p_accepted_at", "p_normalized_url", "p_search_id"]);
    expect(body.p_search_id).toBe(SEARCH_ID);
    expect(body.p_normalized_url).toBe("https://shop.example.com/p/1");
    expect(typeof body.p_accepted_at).toBe("string");
    expect(capturedInit?.body?.toString()).not.toContain("service-role-secret");
  });

  test("maps a missing relationship and database failure without throwing", async () => {
    setSupabaseEnv();
    globalThis.fetch = (async () =>
      new Response("false", { status: 200 })) as unknown as typeof fetch;
    expect(
      await acceptProductMatch({ searchId: SEARCH_ID, productUrl: "https://shop.example.com/p/1" }),
    ).toBe("not_found");

    globalThis.fetch = (async () =>
      new Response("service-role-secret should stay private", {
        status: 500,
      })) as unknown as typeof fetch;
    expect(
      await acceptProductMatch({ searchId: SEARCH_ID, productUrl: "https://shop.example.com/p/1" }),
    ).toBe("error");
  });
});

describe("product acceptance route", () => {
  afterEach(() => {
    clearSupabaseEnv();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  test("returns 200 for a newly or previously accepted relationship", async () => {
    setSupabaseEnv();
    globalThis.fetch = (async () =>
      new Response("true", { status: 200 })) as unknown as typeof fetch;

    const response = await postHandlerOf(ProductAcceptRoute)(
      jsonRequest({ searchId: SEARCH_ID, productUrl: "https://shop.example.com/p/1" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true });
  });

  test("returns a safe 404 when the relationship does not exist", async () => {
    setSupabaseEnv();
    globalThis.fetch = (async () =>
      new Response("false", { status: 200 })) as unknown as typeof fetch;

    const response = await postHandlerOf(ProductAcceptRoute)(
      jsonRequest({ searchId: SEARCH_ID, productUrl: "https://shop.example.com/missing" }),
    );
    const payload = (await response.json()) as { error?: { code?: unknown; message?: unknown } };

    expect(response.status).toBe(404);
    expect(payload.error?.code).toBe("MATCH_NOT_FOUND");
    expect(String(payload.error?.message)).not.toContain("service-role-secret");
  });

  test("returns safe 400 responses for invalid identifiers, URLs, and JSON", async () => {
    setSupabaseEnv();
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("true");
    }) as unknown as typeof fetch;

    const invalidId = await postHandlerOf(ProductAcceptRoute)(
      jsonRequest({ searchId: "not-a-uuid", productUrl: "https://shop.example.com/p/1" }),
    );
    const invalidUrl = await postHandlerOf(ProductAcceptRoute)(
      jsonRequest({ searchId: SEARCH_ID, productUrl: "javascript:alert(1)" }),
    );
    const malformedJson = await postHandlerOf(ProductAcceptRoute)({
      request: new Request("http://localhost/api/product-accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    });

    expect(invalidId.status).toBe(400);
    expect(invalidUrl.status).toBe(400);
    expect(malformedJson.status).toBe(400);
    expect(fetchCalled).toBe(false);
  });

  test("returns a safe 500 when server persistence is unavailable", async () => {
    clearSupabaseEnv();

    const response = await postHandlerOf(ProductAcceptRoute)(
      jsonRequest({ searchId: SEARCH_ID, productUrl: "https://shop.example.com/p/1" }),
    );
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(text).not.toContain("service-role-secret");
  });
});
