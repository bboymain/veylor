import type { ProductSearchResult } from "./product-search";
import { normalizeProductUrl } from "./product-persistence.server";

type ServerEnv = Record<string, string | undefined>;
type SupabaseConfig = { url: string; serviceRoleKey: string };

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

function headers(config: SupabaseConfig, prefer = "return=representation"): HeadersInit {
  return {
    apikey: config.serviceRoleKey,
    authorization: `Bearer ${config.serviceRoleKey}`,
    "content-type": "application/json",
    prefer,
  };
}

export function normalizedDisplayedProductUrls(products: ProductSearchResult[]): string[] {
  const urls = new Set<string>();
  for (const product of products) {
    if (product.source !== "serpapi") continue;
    const normalized = normalizeProductUrl(product.productUrl);
    if (normalized) urls.add(normalized);
  }
  return [...urls];
}

type ImpressionRpcRow = {
  alternatives_updated?: unknown;
  products_refreshed?: unknown;
};

export type AlternativeImpressionResult = {
  alternativesUpdated: number;
  productsRefreshed: number;
};

export function parseImpressionRpcRow(row: ImpressionRpcRow): AlternativeImpressionResult {
  return {
    alternativesUpdated:
      typeof row.alternatives_updated === "number" && row.alternatives_updated >= 0
        ? row.alternatives_updated
        : 0,
    productsRefreshed:
      typeof row.products_refreshed === "number" && row.products_refreshed >= 0
        ? row.products_refreshed
        : 0,
  };
}

export async function recordDisplayedAlternativeImpressions(input: {
  searchId: string | null;
  products: ProductSearchResult[];
}): Promise<AlternativeImpressionResult> {
  const empty = { alternativesUpdated: 0, productsRefreshed: 0 };
  const config = supabaseConfig();
  if (!config || !input.searchId) return empty;

  const normalizedUrls = normalizedDisplayedProductUrls(input.products);
  if (normalizedUrls.length === 0) return empty;

  try {
    const filter = normalizedUrls.map((url) => `"${url.replaceAll('"', '\\"')}"`).join(",");
    const lookup = await fetch(
      `${config.url}/rest/v1/products?select=id&normalized_product_url=in.(${encodeURIComponent(filter)})`,
      { headers: headers(config) },
    );
    if (!lookup.ok) {
      console.error(`[alternative-impressions] Product lookup failed (status ${lookup.status}).`);
      return empty;
    }

    const rows = (await lookup.json()) as Array<{ id?: unknown }>;
    const productIds = [
      ...new Set(rows.map((row) => row.id).filter((id): id is string => typeof id === "string")),
    ];
    if (productIds.length === 0) return empty;

    const response = await fetch(`${config.url}/rest/v1/rpc/record_alternative_impressions`, {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify({
        p_search_id: input.searchId,
        p_product_ids: productIds,
        p_shown_at: new Date().toISOString(),
      }),
    });
    if (!response.ok) {
      console.error(`[alternative-impressions] Impression write failed (status ${response.status}).`);
      return empty;
    }

    const resultRows = (await response.json()) as ImpressionRpcRow[];
    return parseImpressionRpcRow(resultRows[0] ?? {});
  } catch (error) {
    console.error("[alternative-impressions] Impression write failed.", error);
    return empty;
  }
}
