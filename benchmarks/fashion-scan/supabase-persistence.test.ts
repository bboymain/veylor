import { afterEach, describe, expect, test } from "bun:test";
import {
  SupabaseBenchmarkPersistence,
  loadSupabaseServerCredentials,
} from "./supabase-persistence";

const originalUrl = process.env.SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

afterEach(() => {
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
});

describe("server-only Supabase benchmark persistence", () => {
  test("requires dedicated non-public server environment variables", () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY = "must-not-be-used";
    expect(() => loadSupabaseServerCredentials()).toThrow("SUPABASE_URL is required");
    delete process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  });

  test("sends the service credential only in authenticated server headers", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }) as (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
    const persistence = new SupabaseBenchmarkPersistence(
      { url: "https://example.supabase.co", serviceRoleKey: "secret-test-key" },
      fetchMock,
    );
    expect(await persistence.getRunStatus("00000000-0000-5000-8000-000000000000")).toBeNull();
    expect(requests).toHaveLength(1);
    const headers = requests[0].init?.headers as Record<string, string>;
    expect(headers.apikey).toBe("secret-test-key");
    expect(headers.authorization).toBe("Bearer secret-test-key");
    expect(requests[0].url).not.toContain("secret-test-key");
  });

  test("database failures expose status only, never response bodies or secrets", async () => {
    const fetchMock = async () => new Response("private database detail", { status: 400 });
    const persistence = new SupabaseBenchmarkPersistence(
      { url: "https://example.supabase.co", serviceRoleKey: "secret-test-key" },
      fetchMock,
    );
    await expect(persistence.getRunStatus("00000000-0000-5000-8000-000000000000")).rejects.toThrow(
      "Supabase benchmark persistence failed (400).",
    );
  });
});
