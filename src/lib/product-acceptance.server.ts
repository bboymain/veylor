import { normalizeProductUrl } from "./product-persistence.server";

type ServerEnv = Record<string, string | undefined>;

function serverEnv(): ServerEnv {
  return typeof process === "undefined" ? {} : process.env;
}

type SupabaseConfig = {
  url: string;
  serviceRoleKey: string;
};

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
  };
}

export type AcceptProductMatchInput = {
  searchId: string;
  productUrl: string;
};

export type AcceptProductMatchResult = "accepted" | "not_found" | "invalid" | "error";

/**
 * Records explicit result acceptance only. The database RPC owns relationship
 * validation and must never update click, identity, authenticity,
 * classification, cache, benchmark, or model-promotion fields.
 */
export async function acceptProductMatch(
  input: AcceptProductMatchInput,
): Promise<AcceptProductMatchResult> {
  const config = supabaseConfig();
  const normalizedUrl = normalizeProductUrl(input.productUrl);
  if (!normalizedUrl) return "invalid";
  if (!config) return "error";

  try {
    const response = await fetch(`${config.url}/rest/v1/rpc/accept_alternative_match`, {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify({
        p_search_id: input.searchId,
        p_normalized_url: normalizedUrl,
        p_accepted_at: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      console.error(`[product-acceptance] Acceptance RPC failed (status ${response.status}).`);
      return "error";
    }

    const result = (await response.json()) as unknown;
    if (result === true) return "accepted";
    if (result === false) return "not_found";
    return "error";
  } catch {
    console.error("[product-acceptance] Acceptance RPC request failed.");
    return "error";
  }
}
