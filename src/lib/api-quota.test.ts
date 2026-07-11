import { describe, expect, test } from "bun:test";
import { parseApiQuotaRow, quotaExceededResponse } from "./api-quota.server";

describe("API quota parsing", () => {
  test("parses valid quota rows", () => {
    expect(
      parseApiQuotaRow({
        allowed: false,
        remaining: 0,
        retry_after_seconds: 120.2,
      }),
    ).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 121,
      enforced: true,
    });
  });

  test("rejects malformed rows", () => {
    expect(parseApiQuotaRow(undefined)).toBeNull();
    expect(parseApiQuotaRow({ allowed: "yes" })).toBeNull();
  });
});

describe("quota response", () => {
  test("returns a retryable 429 response", async () => {
    const response = quotaExceededResponse(
      { allowed: false, remaining: 0, retryAfterSeconds: 90, enforced: true },
      "Try later.",
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("90");
    expect(await response.json()).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Try later.",
        retryAfterSeconds: 90,
      },
    });
  });
});

describe("Stage 15 policy", () => {
  test("keeps quota storage server-only and limits known paid actions", async () => {
    const sql = await Bun.file(
      "supabase/migrations/20260712023000_stage_15_api_quotas.sql",
    ).text();
    expect(sql).toContain("action in ('gemini_scan', 'product_search')");
    expect(sql).toContain("grant execute on function public.consume_api_quota");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("enable row level security");
    expect(sql).not.toContain("ip_address");
    expect(sql).not.toContain("email");
  });

  test("checks verified scan cache before consuming Gemini quota", async () => {
    const route = await Bun.file("src/routes/api/fashion-scan.ts").text();
    expect(route.indexOf("findVerifiedScanCacheHit")).toBeLessThan(
      route.indexOf('action: "gemini_scan"'),
    );
  });
});
