import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { recordDisplayedAlternativeImpressions } from "@/lib/alternative-impressions.server";
import { SearchIdSchema } from "@/lib/database-identifiers";
import { jsonResponse, type FashionScanItem } from "@/lib/fashion-scan";
import type { ProductSearchInput, ProductSearchResponse } from "@/lib/product-search";
import {
  executeProductSearch,
  ProductSearchInputSchema,
} from "@/lib/product-search-provider";
import { persistProductSearchResults } from "@/lib/product-persistence.server";
import { rankProductSearchResults } from "@/lib/product-ranking.server";
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

        const providerResponse = await executeProductSearch(
          resolveProductSearchProvider(),
          input,
        );

        let manualSearchId: string | null = null;
        if (manualQuery !== null) {
          manualSearchId =
            "error" in providerResponse
              ? await logManualSearchAttempt({
                  status: "error",
                  query: manualQuery,
                  errorMessage: providerResponse.error.message,
                })
              : await logManualSearchAttempt({
                  status: "success",
                  query: manualQuery,
                });
        }

        let response: ProductSearchResponse = providerResponse;
        if (!("error" in providerResponse)) {
          // Stage 12 uses only persisted verification, freshness, impressions,
          // and clicks. It preserves provider order when evidence is missing and
          // limits any result to moving upward by at most two positions.
          const rankedProducts = await rankProductSearchResults(providerResponse.products);
          response = { products: rankedProducts };

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
            products: rankedProducts,
          });

          await recordDisplayedAlternativeImpressions({
            searchId: effectiveSearchId,
            products: rankedProducts,
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
