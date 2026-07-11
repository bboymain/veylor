type ServerEnv = Record<string, string | undefined>;
type SupabaseConfig = { url: string; serviceRoleKey: string };

export type ApiQuotaAction = "gemini_scan" | "product_search";

export type ApiQuotaDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  enforced: boolean;
};

type ApiQuotaRow = {
  allowed?: unknown;
  remaining?: unknown;
  retry_after_seconds?: unknown;
};

function serverEnv(): ServerEnv {
  return typeof process === "undefined" ? {} : process.env;
}

function supabaseConfig(): SupabaseConfig | null {
  const env = serverEnv();
  const url = env.SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) return null;
  return { url: url.replace(/\/+$/, ""), serviceRoleKey };
}

function headers(config: SupabaseConfig): HeadersInit {
  return {
    apikey: config.serviceRoleKey,
    authorization: `Bearer ${config.serviceRoleKey}`,
    "content-type": "application/json",
    prefer: "return=representation",
  };
}

export function parseApiQuotaRow(row: ApiQuotaRow | undefined): ApiQuotaDecision | null {
  if (!row || typeof row.allowed !== "boolean") return null;
  const remaining =
    typeof row.remaining === "number" && Number.isFinite(row.remaining)
      ? Math.max(0, Math.floor(row.remaining))
      : 0;
  const retryAfterSeconds =
    typeof row.retry_after_seconds === "number" && Number.isFinite(row.retry_after_seconds)
      ? Math.max(0, Math.ceil(row.retry_after_seconds))
      : 0;
  return { allowed: row.allowed, remaining, retryAfterSeconds, enforced: true };
}

/**
 * Consumes one quota unit. This deliberately fails open when Supabase is not
 * configured or temporarily unavailable so database trouble does not take the
 * app offline. Only the service-role RPC can access the quota table.
 */
export async function consumeApiQuota(input: {
  profileId: string;
  action: ApiQuotaAction;
  limit: number;
  windowSeconds: number;
}): Promise<ApiQuotaDecision> {
  const config = supabaseConfig();
  if (!config) {
    return { allowed: true, remaining: input.limit, retryAfterSeconds: 0, enforced: false };
  }

  try {
    const response = await fetch(`${config.url}/rest/v1/rpc/consume_api_quota`, {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify({
        p_profile_id: input.profileId,
        p_action: input.action,
        p_limit: input.limit,
        p_window_seconds: input.windowSeconds,
        p_now: new Date().toISOString(),
      }),
    });
    if (!response.ok) {
      console.error(`[api-quota] Quota check failed (status ${response.status}).`);
      return { allowed: true, remaining: input.limit, retryAfterSeconds: 0, enforced: false };
    }

    const rows = (await response.json()) as ApiQuotaRow[];
    return (
      parseApiQuotaRow(rows[0]) ?? {
        allowed: true,
        remaining: input.limit,
        retryAfterSeconds: 0,
        enforced: false,
      }
    );
  } catch (error) {
    console.error("[api-quota] Quota check failed.", error);
    return { allowed: true, remaining: input.limit, retryAfterSeconds: 0, enforced: false };
  }
}

export function quotaExceededResponse(decision: ApiQuotaDecision, message: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: "RATE_LIMITED",
        message,
        retryAfterSeconds: decision.retryAfterSeconds,
      },
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": String(Math.max(1, decision.retryAfterSeconds)),
        "cache-control": "no-store",
      },
    },
  );
}
