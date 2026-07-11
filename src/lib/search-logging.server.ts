import type { FashionScanItem } from "./fashion-scan";

// Server-only Supabase logging for scan attempts and product clicks.
//
// This talks to Supabase's PostgREST endpoint directly over `fetch` instead
// of the `@supabase/supabase-js` SDK, so no new dependency is required.
// The service-role key is read from `process.env` only (never `import.meta.env`
// or a `VITE_`-prefixed variable) and must never be imported from client code.
// Every export here is best-effort: failures are logged and swallowed so that
// scanning and product links keep working even when Supabase is unavailable
// or unconfigured.

type ServerEnv = Record<string, string | undefined>;

function serverEnv(): ServerEnv {
  return typeof process === "undefined" ? {} : process.env;
}

let hasWarnedMissingConfig = false;

function warnMissingConfigOnce() {
  if (hasWarnedMissingConfig) return;
  hasWarnedMissingConfig = true;
  console.warn(
    "[search-logging] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set. " +
      "Search logging is disabled; scanning and product links continue to work normally.",
  );
}

type SupabaseConfig = {
  url: string;
  serviceRoleKey: string;
};

function supabaseConfig(): SupabaseConfig | null {
  const env = serverEnv();
  const url = env.SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !serviceRoleKey) {
    warnMissingConfigOnce();
    return null;
  }

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

const MAX_ERROR_MESSAGE_LENGTH = 500;

function sanitizeErrorMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

export type LogScanAttemptInput =
  | {
      status: "success";
      model: string;
      summary: string;
      detectedItems: FashionScanItem[];
      primarySearchQuery: string;
      imageSha256?: string;
      cacheSourceSearchId?: string;
    }
  | {
      status: "error";
      errorMessage: string;
      imageSha256?: string;
    };

/**
 * Inserts one row into the searches table. Returns the new row's id on
 * success, or null when Supabase is not configured or the write fails.
 * Never throws.
 */
async function insertSearchRow(
  row: Record<string, unknown>,
  logLabel: string,
): Promise<string | null> {
  const config = supabaseConfig();
  if (!config) return null;

  try {
    const response = await fetch(`${config.url}/rest/v1/searches`, {
      method: "POST",
      headers: supabaseHeaders(config, "return=representation"),
      body: JSON.stringify(row),
    });

    if (!response.ok) {
      console.error(`[search-logging] Failed to log ${logLabel} (status ${response.status}).`);
      return null;
    }

    const rows = (await response.json()) as Array<{ id?: unknown }>;
    const id = rows[0]?.id;
    return typeof id === "string" ? id : null;
  } catch (error) {
    console.error(`[search-logging] Failed to log ${logLabel}.`, error);
    return null;
  }
}

/**
 * Records one row per scan attempt. New AI rows remain cache-unverified by
 * database default; Stage 10 will define evidence-based promotion.
 */
export async function logScanAttempt(input: LogScanAttemptInput): Promise<string | null> {
  const row =
    input.status === "success"
      ? {
          status: "success",
          model: input.model,
          summary: input.summary,
          detected_items: input.detectedItems,
          primary_search_query: input.primarySearchQuery,
          image_sha256: input.imageSha256 ?? null,
          cache_source_search_id: input.cacheSourceSearchId ?? null,
        }
      : {
          status: "error",
          error_message: sanitizeErrorMessage(input.errorMessage),
          image_sha256: input.imageSha256 ?? null,
        };

  return insertSearchRow(row, "scan attempt");
}

/** Identifies manual product-search rows in the shared searches table. */
export const MANUAL_SEARCH_MODEL = "manual";

export type LogManualSearchInput =
  | { status: "success"; query: string }
  | { status: "error"; query: string; errorMessage: string };

/** Records one row per manual product-search attempt. */
export async function logManualSearchAttempt(input: LogManualSearchInput): Promise<string | null> {
  const row = {
    status: input.status,
    model: MANUAL_SEARCH_MODEL,
    summary: "Manual product search",
    primary_search_query: input.query,
    ...(input.status === "error"
      ? { error_message: sanitizeErrorMessage(input.errorMessage) }
      : {}),
  };

  return insertSearchRow(row, "manual product search");
}

export type ProductClickInput = {
  searchId: string;
  productUrl: string;
  productTitle: string;
  retailer: string;
  tier: string;
};

/** Records a product click against an existing search row. */
export async function recordProductClick(input: ProductClickInput): Promise<boolean> {
  const config = supabaseConfig();
  if (!config) return false;

  try {
    const response = await fetch(
      `${config.url}/rest/v1/searches?id=eq.${encodeURIComponent(input.searchId)}`,
      {
        method: "PATCH",
        headers: supabaseHeaders(config, "return=minimal"),
        body: JSON.stringify({
          clicked: true,
          clicked_at: new Date().toISOString(),
          clicked_product_url: input.productUrl,
          clicked_product_title: input.productTitle,
          clicked_retailer: input.retailer,
          clicked_tier: input.tier,
        }),
      },
    );

    if (!response.ok) {
      console.error(`[search-logging] Failed to record product click (status ${response.status}).`);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[search-logging] Failed to record product click.", error);
    return false;
  }
}
