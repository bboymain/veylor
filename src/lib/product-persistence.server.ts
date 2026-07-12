import type { ProductSearchResult } from "./product-search";
import {
  brandMatches,
  classifyProduct,
  normalizeBrandName,
  normalizeProductTitle,
  retailerDomainFromUrl,
  type BrandRecord,
  type ClassificationResult,
  type MarketTier,
  type BrandVerificationStatus,
} from "./product-classification.server";

// Server-only persistence of normalized product candidates.
//
// Talks to Supabase's PostgREST endpoint over `fetch` (same pattern as
// search-logging.server.ts): the service-role key comes from `process.env`
// only and must never reach client code. Every export is best-effort — any
// failure is logged generically and swallowed so shoppers still see results
// when the database is down or unconfigured.
//
// What is stored: normalized fields listed below, never raw SerpApi payloads,
// request URLs, or API keys.

type ServerEnv = Record<string, string | undefined>;

function serverEnv(): ServerEnv {
  return typeof process === "undefined" ? {} : process.env;
}

type SupabaseConfig = { url: string; serviceRoleKey: string };

function supabaseConfig(): SupabaseConfig | null {
  const env = serverEnv();
  const url = env.SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) return null;
  return { url: url.replace(/\/+$/, ""), serviceRoleKey };
}

function supabaseHeaders(config: SupabaseConfig, prefer: string): HeadersInit {
  return {
    apikey: config.serviceRoleKey,
    authorization: `Bearer ${config.serviceRoleKey}`,
    "content-type": "application/json",
    prefer,
  };
}

/** Query params that identify tracking, not the product. Removed before storage. */
const TRACKING_PARAM_PATTERN = /^(utm_|gclid$|fbclid$|msclkid$|srsltid$|ref$|referrer$)/;

/**
 * Canonical product-URL form used for products.normalized_product_url and
 * deduplication: http(s) only, lowercased host, no fragment, tracking params
 * removed, remaining params sorted, no trailing slash. Returns null for
 * unusable URLs (which are then never persisted).
 */
export function normalizeProductUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;

    const params = [...url.searchParams.entries()]
      .filter(([key]) => !TRACKING_PARAM_PATTERN.test(key.toLowerCase()))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const query = params
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");

    const path = url.pathname !== "/" ? url.pathname.replace(/\/+$/, "") : "";
    return `${url.protocol}//${url.host.toLowerCase()}${path}${query ? `?${query}` : ""}`;
  } catch {
    return null;
  }
}

const MARKET_TIER_VALUES: readonly string[] = [
  "luxury",
  "premium",
  "mid_market",
  "budget",
  "unknown",
];
const VERIFICATION_VALUES: readonly string[] = ["verified", "unverified", "unknown"];

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** Defensive mapping of a PostgREST brands row into a BrandRecord. */
function parseBrandRow(row: unknown): BrandRecord | null {
  if (typeof row !== "object" || row === null) return null;
  const record = row as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.normalized_name !== "string") return null;
  const marketTier = typeof record.market_tier === "string" ? record.market_tier : "unknown";
  const verification =
    typeof record.verification_status === "string" ? record.verification_status : "unknown";
  return {
    id: record.id,
    normalizedName: record.normalized_name,
    aliases: asStringArray(record.aliases),
    marketTier: (MARKET_TIER_VALUES.includes(marketTier) ? marketTier : "unknown") as MarketTier,
    verificationStatus: (VERIFICATION_VALUES.includes(verification)
      ? verification
      : "unknown") as BrandVerificationStatus,
    officialDomains: asStringArray(record.official_domains),
    trustedRetailers: asStringArray(record.trusted_retailers),
  };
}

/**
 * Looks up a brands row by exact normalized name or normalized alias.
 * Returns null on any failure — a missing brand is not an error.
 */
async function findBrand(
  normalizedName: string,
  config: SupabaseConfig,
): Promise<BrandRecord | null> {
  if (!normalizedName) return null;
  try {
    const select =
      "id,normalized_name,aliases,market_tier,verification_status,official_domains,trusted_retailers";
    const filter = `or=(normalized_name.eq.${normalizedName},aliases.cs.{${normalizedName}})`;
    const response = await fetch(
      `${config.url}/rest/v1/brands?select=${select}&${filter}&order=created_at.asc&limit=1`,
      { headers: supabaseHeaders(config, "return=representation") },
    );
    if (!response.ok) return null;
    const rows = (await response.json()) as unknown[];
    const brand = parseBrandRow(rows[0]);
    // Defensive: only use the row if it deterministically matches.
    return brand && brandMatches(brand, normalizedName) ? brand : null;
  } catch {
    return null;
  }
}

type PersistCandidate = {
  product: ProductSearchResult;
  normalizedUrl: string;
  resultRank: number;
  classification: ClassificationResult;
};

export type PersistProductSearchInput = {
  /** searches.id to link alternatives to; null skips alternatives entirely. */
  searchId: string | null;
  /** The query string that produced these results (trimmed by callers). */
  queryUsed: string;
  /** Brand name reported by the scan/user, if any. Null for manual searches. */
  detectedBrandName: string | null;
  /** Products exactly as returned to the user (order = display order). */
  products: ProductSearchResult[];
};

/**
 * Best-effort persistence of a successful product search. Never throws.
 *
 *   1. Filters to real provider results: mock fallback rows and malformed
 *      entries (bad URL, empty title) are never persisted.
 *   2. Classifies each candidate deterministically.
 *   3. Upserts products on (source, normalized_product_url) so repeat searches
 *      update last_seen_at/classification instead of duplicating rows.
 *   4. When a searchId exists, inserts alternatives rows preserving display
 *      order via 1-based result_rank; duplicates (same search & product) are
 *      ignored so click data is never clobbered.
 */
export async function persistProductSearchResults(input: PersistProductSearchInput): Promise<void> {
  const config = supabaseConfig();
  if (!config) return;

  try {
    const seenUrls = new Set<string>();
    const candidates: PersistCandidate[] = [];
    let brand: BrandRecord | null = null;
    let brandLoaded = false;

    for (const [index, product] of input.products.entries()) {
      // Mock fallback results are presentation-only and never persisted.
      if (product.source !== "serpapi") continue;
      const title = product.title.trim();
      if (!title) continue;
      const normalizedUrl = normalizeProductUrl(product.productUrl);
      if (!normalizedUrl) continue;
      const dedupeKey = `${product.source} ${normalizedUrl}`;
      if (seenUrls.has(dedupeKey)) continue;
      seenUrls.add(dedupeKey);

      if (!brandLoaded) {
        brandLoaded = true;
        const normalizedBrand = normalizeBrandName(input.detectedBrandName ?? "");
        brand = normalizedBrand ? await findBrand(normalizedBrand, config) : null;
      }

      const classification = classifyProduct({
        title,
        detectedBrandName: input.detectedBrandName,
        retailer: product.retailer === "Unknown" ? null : product.retailer,
        retailerDomain: retailerDomainFromUrl(product.productUrl),
        price: Number.isFinite(product.price) && product.price > 0 ? product.price : null,
        productUrl: product.productUrl,
        brand,
      });

      candidates.push({
        product,
        normalizedUrl,
        resultRank: index + 1,
        classification,
      });
    }

    if (candidates.length === 0) return;

    const now = new Date().toISOString();
    const productRows = candidates.map(({ product, normalizedUrl, classification }) => ({
      external_id: product.id || null,
      source: product.source,
      title: product.title.trim(),
      normalized_title: normalizeProductTitle(product.title),
      brand_id: classification.brandId,
      detected_brand_name: input.detectedBrandName?.trim() || null,
      product_url: product.productUrl,
      normalized_product_url: normalizedUrl,
      retailer: product.retailer === "Unknown" ? null : product.retailer,
      retailer_domain: retailerDomainFromUrl(product.productUrl),
      image_url: product.imageUrl || null,
      price: Number.isFinite(product.price) && product.price > 0 ? product.price : null,
      currency: product.currency || null,
      market_tier: classification.marketTier,
      authenticity_status: classification.authenticityStatus,
      classification_confidence: classification.confidence,
      classification_reason: classification.reason,
      last_seen_at: now,
      updated_at: now,
    }));

    const upsertResponse = await fetch(
      `${config.url}/rest/v1/products?on_conflict=source,normalized_product_url`,
      {
        method: "POST",
        headers: supabaseHeaders(config, "resolution=merge-duplicates,return=representation"),
        body: JSON.stringify(productRows),
      },
    );
    if (!upsertResponse.ok) {
      console.error(
        `[product-persistence] Product upsert failed (status ${upsertResponse.status}).`,
      );
      return;
    }

    if (!input.searchId) return;

    const upserted = (await upsertResponse.json()) as Array<{
      id?: unknown;
      normalized_product_url?: unknown;
    }>;
    const idByUrl = new Map<string, string>();
    for (const row of upserted) {
      if (typeof row.id === "string" && typeof row.normalized_product_url === "string") {
        idByUrl.set(row.normalized_product_url, row.id);
      }
    }

    const alternativeRows = candidates.flatMap(({ normalizedUrl, resultRank, classification }) => {
      const productId = idByUrl.get(normalizedUrl);
      if (!productId) return [];
      return [
        {
          search_id: input.searchId,
          product_id: productId,
          result_rank: resultRank,
          query_used: input.queryUsed,
          provider: "serpapi",
          classification_label: classification.authenticityStatus,
          classification_reason: classification.reason,
        },
      ];
    });
    if (alternativeRows.length === 0) return;

    const alternativesResponse = await fetch(
      `${config.url}/rest/v1/alternatives?on_conflict=search_id,product_id`,
      {
        method: "POST",
        headers: supabaseHeaders(config, "resolution=ignore-duplicates,return=minimal"),
        body: JSON.stringify(alternativeRows),
      },
    );
    if (!alternativesResponse.ok) {
      console.error(
        `[product-persistence] Alternatives insert failed (status ${alternativesResponse.status}).`,
      );
    }
  } catch (error) {
    console.error("[product-persistence] Failed to persist product search results.", error);
  }
}

export type AlternativeClickInput = {
  searchId: string;
  productUrl: string;
};

/**
 * Best-effort: records interest/ranking signals on the matching alternative.
 * This click PATCH must never update verification, authenticity,
 * classification, cache promotion, or trusted identity fields. Never throws;
 * the merchant link must open regardless.
 */
export async function recordAlternativeClick(input: AlternativeClickInput): Promise<boolean> {
  const config = supabaseConfig();
  if (!config) return false;

  const normalizedUrl = normalizeProductUrl(input.productUrl);
  if (!normalizedUrl) return false;

  try {
    const lookup = await fetch(
      `${config.url}/rest/v1/products?select=id&normalized_product_url=eq.${encodeURIComponent(normalizedUrl)}`,
      { headers: supabaseHeaders(config, "return=representation") },
    );
    if (!lookup.ok) return false;
    const rows = (await lookup.json()) as Array<{ id?: unknown }>;
    const ids = rows.map((row) => row.id).filter((id): id is string => typeof id === "string");
    if (ids.length === 0) return false;

    const response = await fetch(
      `${config.url}/rest/v1/alternatives?search_id=eq.${encodeURIComponent(input.searchId)}&product_id=in.(${ids.join(",")})`,
      {
        method: "PATCH",
        headers: supabaseHeaders(config, "return=minimal"),
        body: JSON.stringify({ clicked: true, clicked_at: new Date().toISOString() }),
      },
    );
    if (!response.ok) {
      console.error(
        `[product-persistence] Alternative click update failed (status ${response.status}).`,
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error("[product-persistence] Failed to record alternative click.", error);
    return false;
  }
}
