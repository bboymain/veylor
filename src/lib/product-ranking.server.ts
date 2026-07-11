import {
  loadShopperPreferences,
  shopperPreferenceScore,
  type ShopperPreferences,
} from "./anonymous-shopper.server";
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

function headers(config: SupabaseConfig): HeadersInit {
  return {
    apikey: config.serviceRoleKey,
    authorization: `Bearer ${config.serviceRoleKey}`,
    "content-type": "application/json",
    prefer: "return=representation",
  };
}

export type ProductRankingEvidence = {
  normalizedProductUrl: string;
  verificationStatus: "verified" | "unverified" | "rejected" | "unknown";
  freshnessStatus: "fresh" | "stale" | "unavailable" | "unknown";
  totalImpressions: number;
  totalClicks: number;
};

type RankingEvidenceRow = {
  normalized_product_url?: unknown;
  verification_status?: unknown;
  freshness_status?: unknown;
  total_impressions?: unknown;
  total_clicks?: unknown;
};

const verificationValues = new Set(["verified", "unverified", "rejected"]);
const freshnessValues = new Set(["fresh", "stale", "unavailable", "unknown"]);

export function parseRankingEvidenceRow(row: RankingEvidenceRow): ProductRankingEvidence | null {
  if (typeof row.normalized_product_url !== "string") return null;
  const verificationStatus =
    typeof row.verification_status === "string" && verificationValues.has(row.verification_status)
      ? row.verification_status
      : "unknown";
  const freshnessStatus =
    typeof row.freshness_status === "string" && freshnessValues.has(row.freshness_status)
      ? row.freshness_status
      : "unknown";
  const totalImpressions =
    typeof row.total_impressions === "number" && row.total_impressions >= 0
      ? row.total_impressions
      : 0;
  const totalClicks =
    typeof row.total_clicks === "number" && row.total_clicks >= 0 ? row.total_clicks : 0;

  return {
    normalizedProductUrl: row.normalized_product_url,
    verificationStatus: verificationStatus as ProductRankingEvidence["verificationStatus"],
    freshnessStatus: freshnessStatus as ProductRankingEvidence["freshnessStatus"],
    totalImpressions,
    totalClicks,
  };
}

export function productEvidenceScore(evidence: ProductRankingEvidence | undefined): number {
  if (!evidence) return 0;

  let score = 0;
  if (evidence.verificationStatus === "verified") score += 2;
  if (evidence.verificationStatus === "rejected") score -= 3;

  if (evidence.freshnessStatus === "fresh") score += 0.5;
  if (evidence.freshnessStatus === "stale") score -= 0.5;
  if (evidence.freshnessStatus === "unavailable") score -= 3;

  if (evidence.totalImpressions >= 3) {
    const smoothedCtr = (evidence.totalClicks + 1) / (evidence.totalImpressions + 4);
    score += Math.min(1.5, smoothedCtr * 3);
  }

  return score;
}

/**
 * Stable evidence ranking with a strict maximum upward displacement. Global
 * evidence remains dominant; anonymous preferences contribute at most one
 * point and cannot move any result upward by more than the existing cap.
 */
export function rankProductsWithEvidence(
  products: ProductSearchResult[],
  evidenceByUrl: Map<string, ProductRankingEvidence>,
  maxUpwardDisplacement = 2,
  preferences: ShopperPreferences | null = null,
): ProductSearchResult[] {
  const remaining = products.map((product, originalIndex) => {
    const normalizedUrl = normalizeProductUrl(product.productUrl);
    return {
      product,
      originalIndex,
      score:
        (normalizedUrl ? productEvidenceScore(evidenceByUrl.get(normalizedUrl)) : 0) +
        shopperPreferenceScore(product, preferences),
    };
  });

  const ranked: ProductSearchResult[] = [];
  for (let outputIndex = 0; outputIndex < products.length; outputIndex += 1) {
    const eligible = remaining.filter(
      (candidate) => candidate.originalIndex <= outputIndex + maxUpwardDisplacement,
    );
    eligible.sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex);
    const selected = eligible[0] ?? remaining[0];
    ranked.push(selected.product);
    remaining.splice(remaining.indexOf(selected), 1);
  }

  return ranked;
}

async function loadRankingEvidence(
  products: ProductSearchResult[],
): Promise<Map<string, ProductRankingEvidence>> {
  const config = supabaseConfig();
  if (!config) return new Map();

  const normalizedUrls = [
    ...new Set(
      products
        .filter((product) => product.source === "serpapi")
        .map((product) => normalizeProductUrl(product.productUrl))
        .filter((url): url is string => url !== null),
    ),
  ];
  if (normalizedUrls.length === 0) return new Map();

  try {
    const response = await fetch(`${config.url}/rest/v1/rpc/get_product_ranking_evidence`, {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify({ p_normalized_product_urls: normalizedUrls }),
    });
    if (!response.ok) {
      console.error(`[product-ranking] Evidence lookup failed (status ${response.status}).`);
      return new Map();
    }

    const rows = (await response.json()) as RankingEvidenceRow[];
    const evidence = new Map<string, ProductRankingEvidence>();
    for (const row of rows) {
      const parsed = parseRankingEvidenceRow(row);
      if (parsed) evidence.set(parsed.normalizedProductUrl, parsed);
    }
    return evidence;
  } catch (error) {
    console.error("[product-ranking] Evidence lookup failed.", error);
    return new Map();
  }
}

export async function rankProductSearchResults(
  products: ProductSearchResult[],
  shopperProfileId: string | null = null,
): Promise<ProductSearchResult[]> {
  if (products.length < 2 || products.every((product) => product.source !== "serpapi")) {
    return products;
  }

  const [evidence, preferences] = await Promise.all([
    loadRankingEvidence(products),
    shopperProfileId ? loadShopperPreferences(shopperProfileId) : Promise.resolve(null),
  ]);

  if (evidence.size === 0 && !preferences) return products;
  return rankProductsWithEvidence(products, evidence, 2, preferences);
}
