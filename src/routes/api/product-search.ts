import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { recordDisplayedAlternativeImpressions } from "@/lib/alternative-impressions.server";
import { SearchIdSchema } from "@/lib/database-identifiers";
import { jsonResponse, type FashionScanItem } from "@/lib/fashion-scan";
import type { ProductSearchInput } from "@/lib/product-search";
import {
  executeProductSearch,
  ProductSearchInputSchema,
} from "@/lib/product-search-provider";
import { persistProductSearchResults } from "@/lib/product-persistence.server";
import { logManualSearchAttempt } from "@/lib/search-logging.server";
import { resolveProductSearchProvider } from "@/lib/serpapi-product-search.server";

export const MAX_MANUAL_QUERY_LENGTH = 200;

// Manual searches send only a typed clothing description — no Gemini scan is
// involved. The query is trimmed, must be non-empty, and is length-limited.
const ManualSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(MAX_MANUAL_QUERY_LENGTH),
});

// Additive, optional: the scan UI may include the searchId returned by
// /api/fashion-scan alongside scan-shaped input so returned candidates can be
// linked to that search as alternatives rows. Absent for older clients.
export const ScanSearchIdSchema = z.object({
  searchId: SearchIdSchema.optional(),
});

/** Confidence floor matching the UI's "visible brand" display threshold. */
const DETECTED_BRAND_MIN_CONFIDENCE = 0.5;

/**
 * Wraps a manual query in the provider input contract. The SerpApi provider
 * only reads `searchQueries[0]`; the synthetic item exists so the mock
 * fallback (used when SERPAPI_API_KEY is missing) still has fields to render.
 */
function manualSearchInput(query: string): ProductSearchInput {
  const item: FashionScanItem = {
    id: "manual-search",
    category: "clothing item",
    name: query,
    color: "as described",
    material: null,
    style: "as described",
    pattern: null,
    visibleBrand: null,
    brandConfidence: 0,
    confidence: 1,
    searchQueries: [query],
    affordableAlternativeQueries: [query],
    premiumAlternativeQueries: [query],
  };
  return { item, searchQueries: [query] };
}

export const Route = createFileRoute("/api/product-search")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const contentType = request.headers.get("content-type") ?? "";
        if (!contentType.includes("application/json")) {
          return jsonResponse(
            {
              error: {
                code: "INVALID_REQUEST",
                message: "Expected a JSON request.",
              },
            },
            415,
          );
        }

        const body: unknown = await request.json();

        // Scan-shaped input is tried first so existing behavior is unchanged;
        // otherwise accept a manual `{ query }` payload.
        let input: ProductSearchInput;
        let manualQuery: string | null = null;
        let scanSearchId: string | null = null;
        const scanInput = ProductSearchInputSchema.safeParse(body);
        if (scanInput.success) {
          input = scanInput.data;
          const withSearchId = ScanSearchIdSchema.safeParse(body);
          scanSearchId = withSearchId.success
            ? (withSearchId.data.searchId ?? null)
            : null;
        } else {
          const manualInput = ManualSearchInputSchema.safeParse(body);
          if (!manualInput.success) {
            // Invalid/empty manual queries are rejected before any logging.
            return jsonResponse(
              {
                error: {
                  code: "INVALID_REQUEST",
                  message: "Invalid product-search input.",
                },
              },
              400,
            );
          }
          manualQuery = manualInput.data.query;
          input = manualSearchInput(manualQuery);
        }

        const response = await executeProductSearch(
          resolveProductSearchProvider(),
          input,
        );

        // Only manual searches are logged here (one row per attempt); scan-based
        // searches already get their row from /api/fashion-scan, so logging them
        // again would create duplicates. Logging is best-effort and never blocks
        // or breaks the product results.
        let manualSearchId: string | null = null;
        if (manualQuery !== null) {
          manualSearchId =
            "error" in response
              ? await logManualSearchAttempt({
                  status: "error",
                  query: manualQuery,
                  errorMessage: response.error.message,
                })
              : await logManualSearchAttempt({
                  status: "success",
                  query: manualQuery,
                });
        }

        // Best-effort persistence of real (non-mock) candidates into the
        // products/alternatives tables. Never throws and never blocks results;
        // alternatives are linked only when a searchId is known (manual: the
        // row logged above; scan: the id the client received from
        // /api/fashion-scan). Mock fallback results are never persisted.
        if (!("error" in response)) {
          const detectedBrandName =
            manualQuery === null &&
            input.item.visibleBrand &&
            input.item.brandConfidence >= DETECTED_BRAND_MIN_CONFIDENCE
              ? input.item.visibleBrand
              : null;
          const effectiveSearchId =
            manualQuery !== null ? manualSearchId : scanSearchId;

          await persistProductSearchResults({
            searchId: effectiveSearchId,
            queryUsed: manualQuery ?? input.searchQueries[0],
            detectedBrandName,
            products: response.products,
          });

          // Stage 11 records only persisted SerpApi alternatives that were
          // actually returned to the user. The RPC re-checks the search/product
          // relationship, so forged or missing IDs cannot create impressions.
          await recordDisplayedAlternativeImpressions({
            searchId: effectiveSearchId,
            products: response.products,
          });
        }

        if (manualQuery !== null) {
          return jsonResponse(
            { ...response, searchId: manualSearchId },
            "error" in response ? 502 : 200,
          );
        }

        return jsonResponse(response, "error" in response ? 502 : 200);
      },
    },
  },
});
