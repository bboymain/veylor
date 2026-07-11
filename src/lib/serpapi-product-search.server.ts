import type { ProductSearchInput, ProductSearchResult, ProductTier } from "./product-search";
import { mockProductSearchProvider, type ProductSearchProvider } from "./product-search-provider";

// Server-only SerpApi (Google Shopping) implementation of ProductSearchProvider.
//
// SERPAPI_API_KEY is read from `process.env` only (never `import.meta.env` or a
// `VITE_`-prefixed variable) and must never be imported from client code. The
// key is added to the request URL right before fetching and is never included
// in thrown errors, logs, or responses.

const MAX_PRODUCTS_PER_ITEM = 6;

type ServerEnv = Record<string, string | undefined>;

function serverEnv(): ServerEnv {
  return typeof process === "undefined" ? {} : process.env;
}

function serpApiKey(): string | null {
  const key = serverEnv().SERPAPI_API_KEY?.trim();
  return key ? key : null;
}

/**
 * Shape of the SerpApi `shopping_results` entries we consume. All fields are
 * treated as untrusted/optional and validated defensively during
 * normalization.
 */
type SerpApiShoppingResult = {
  position?: number;
  product_id?: string;
  title?: string;
  link?: string;
  product_link?: string;
  source?: string;
  price?: string;
  extracted_price?: number;
  thumbnail?: string;
};

type SerpApiResponse = {
  shopping_results?: SerpApiShoppingResult[];
  error?: string;
};

function asHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort currency detection from SerpApi's display price string.
 * SerpApi defaults to google.com (US) when no localization params are sent,
 * so results without a recognizable symbol are treated as USD.
 */
function currencyFromPriceString(price: string | undefined): string {
  if (price) {
    if (price.includes("£")) return "GBP";
    if (price.includes("€")) return "EUR";
    if (price.includes("¥")) return "JPY";
    if (/\bCA\$/.test(price)) return "CAD";
    if (/\bA\$/.test(price)) return "AUD";
  }
  return "USD";
}

/**
 * Defensive price parsing. Prefers SerpApi's numeric `extracted_price`;
 * falls back to parsing the display string (e.g. "$1,299.00"). Returns null
 * when no trustworthy price is present — prices are never invented.
 */
function parsePrice(result: SerpApiShoppingResult): number | null {
  if (typeof result.extracted_price === "number" && Number.isFinite(result.extracted_price)) {
    return result.extracted_price > 0 ? result.extracted_price : null;
  }
  if (typeof result.price === "string") {
    const numeric = Number.parseFloat(result.price.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return null;
}

type NormalizedProduct = Omit<ProductSearchResult, "tier">;

function normalizeSerpApiResult(
  result: SerpApiShoppingResult,
  index: number,
): NormalizedProduct | null {
  // Skip results without a usable title.
  const title = typeof result.title === "string" ? result.title.trim() : "";
  if (!title) return null;

  // Skip results without a usable product URL. Prefer the direct merchant
  // link over Google's product page when SerpApi returns both.
  const productUrl = asHttpUrl(result.link) ?? asHttpUrl(result.product_link);
  if (!productUrl) return null;

  // Products without a trustworthy price are dropped (deterministically —
  // never displayed) because the existing product contract requires a
  // numeric price and inventing one is not acceptable.
  const price = parsePrice(result);
  if (price === null) return null;

  return {
    id: `serpapi-${result.product_id ?? result.position ?? index}`,
    title,
    // Images are never invented: missing thumbnails become an empty string
    // and the UI simply renders no image.
    imageUrl: asHttpUrl(result.thumbnail) ?? "",
    productUrl,
    price,
    currency: currencyFromPriceString(result.price),
    // Retailers are never invented: "Unknown" explicitly marks absence.
    retailer: result.source?.trim() || "Unknown",
    source: "serpapi",
  };
}

/**
 * TEMPORARY display grouping — NOT verified brand classification.
 *
 * Until real authenticity/brand verification exists, usable products are
 * sorted by price (lowest → highest) and split for display only:
 *   - the single highest-priced product becomes "authentic"
 *   - the lower half of the rest becomes "budget"
 *   - the upper half of the rest becomes "premium"
 * Ties keep SerpApi's original order (stable sort), so grouping is
 * deterministic for identical responses.
 */
export function assignTemporaryTiers(products: NormalizedProduct[]): ProductSearchResult[] {
  const sorted = [...products].sort((a, b) => a.price - b.price);
  const count = sorted.length;

  return sorted.map((product, index) => {
    let tier: ProductTier;
    if (index === count - 1) {
      tier = "authentic";
    } else if (index < Math.ceil((count - 1) / 2)) {
      tier = "budget";
    } else {
      tier = "premium";
    }
    return { ...product, tier };
  });
}

async function searchSerpApi(input: ProductSearchInput, apiKey: string) {
  // Use the existing detected item's first/main search query.
  const query = input.searchQueries[0];

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_shopping");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", apiKey);

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    // Never rethrow the underlying error: fetch failures can embed the
    // request URL (which contains the API key) in their message.
    throw new Error("The shopping search service could not be reached.");
  }

  if (!response.ok) {
    throw new Error(`The shopping search service returned an error (status ${response.status}).`);
  }

  const payload = (await response.json()) as SerpApiResponse;
  if (payload.error) {
    // SerpApi error strings describe the request, not our secrets, but keep
    // the client-facing message generic anyway.
    console.error("[product-search] SerpApi reported an error for a shopping search.");
    throw new Error("The shopping search failed.");
  }

  const rawResults = Array.isArray(payload.shopping_results) ? payload.shopping_results : [];
  const usable: NormalizedProduct[] = [];
  for (const [index, result] of rawResults.entries()) {
    if (usable.length >= MAX_PRODUCTS_PER_ITEM) break;
    const normalized = normalizeSerpApiResult(result, index);
    if (normalized) usable.push(normalized);
  }

  return assignTemporaryTiers(usable);
}

export function createSerpApiProductSearchProvider(apiKey: string): ProductSearchProvider {
  return {
    async search(input) {
      return searchSerpApi(input, apiKey);
    },
  };
}

/**
 * Returns the SerpApi provider when SERPAPI_API_KEY is configured, otherwise
 * falls back to the mock provider. Evaluated per call so environment changes
 * are picked up without module-load ordering concerns.
 */
export function resolveProductSearchProvider(): ProductSearchProvider {
  const apiKey = serpApiKey();
  return apiKey ? createSerpApiProductSearchProvider(apiKey) : mockProductSearchProvider;
}
