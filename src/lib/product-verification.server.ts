import { normalizeProductUrl } from "./product-persistence.server";

type ServerEnv = Record<string, string | undefined>;

type SupabaseConfig = {
  url: string;
  serviceRoleKey: string;
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

export type ProductClickVerificationResult = {
  alternativeVerified: boolean;
  productVerified: boolean;
  searchCacheVerified: boolean;
};

type VerificationRpcRow = {
  alternative_verified?: unknown;
  product_verified?: unknown;
  search_cache_verified?: unknown;
};

export function parseVerificationRpcRow(row: VerificationRpcRow): ProductClickVerificationResult {
  return {
    alternativeVerified: row.alternative_verified === true,
    productVerified: row.product_verified === true,
    searchCacheVerified: row.search_cache_verified === true,
  };
}

export type VerifyProductClickInput = {
  searchId: string;
  productUrl: string;
};

/**
 * Applies Stage 10 verification through one relationship-scoped database RPC.
 * A missing alternative returns all false. Database errors are best-effort and
 * never prevent the merchant link from opening.
 */
export async function verifyProductClickEvidence(
  input: VerifyProductClickInput,
): Promise<ProductClickVerificationResult> {
  const config = supabaseConfig();
  const normalizedUrl = normalizeProductUrl(input.productUrl);
  if (!config || !normalizedUrl) {
    return {
      alternativeVerified: false,
      productVerified: false,
      searchCacheVerified: false,
    };
  }

  try {
    const response = await fetch(`${config.url}/rest/v1/rpc/verify_product_click`, {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify({
        p_search_id: input.searchId,
        p_normalized_product_url: normalizedUrl,
        p_clicked_at: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      console.error(`[product-verification] Verification failed (status ${response.status}).`);
      return {
        alternativeVerified: false,
        productVerified: false,
        searchCacheVerified: false,
      };
    }

    const rows = (await response.json()) as VerificationRpcRow[];
    return parseVerificationRpcRow(rows[0] ?? {});
  } catch (error) {
    console.error("[product-verification] Verification failed.", error);
    return {
      alternativeVerified: false,
      productVerified: false,
      searchCacheVerified: false,
    };
  }
}
