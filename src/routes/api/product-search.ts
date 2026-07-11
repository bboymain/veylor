import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { recordDisplayedAlternativeImpressions } from "@/lib/alternative-impressions.server";
import { consumeApiQuota, quotaExceededResponse } from "@/lib/api-quota.server";
import {
  attachAnonymousShopperCookie,
  resolveAnonymousShopper,
} from "@/lib/anonymous-shopper.server";
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

const PRODUCT_SEARCH_LIMIT = 40;
const PRODUCT_SEARCH_WINDOW_SECONDS = 60 * 60;

const ManualSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(MAX_MANUAL_QUERY_LENGTH),
});

export const ScanSearchIdSchema = z.object({
  searchId: SearchIdSchema.optional(),
});

const DETECTED_BRAND_MIN_CONFIDENCE = 0.5;

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
        const shopper = resolveAnonymousShopper(request);
        const contentType = request.headers.get("content-type") ?? "";
        if (!contentType.includes("application/json")) {
          return attachAnonymousShopperCookie(
            jsonResponse(
              {
                error: {
                  code: "INVALID_REQUEST",
                  message: "Expected a JSON request.",
                },
              },
              415,
            ),
            shopper,
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
            return attachAnonymousShopperCookie(
              jsonResponse(
                {
                  error: {
                    code: "INVALID_REQUEST",
                    message: "Invalid product-search input.",
                  },
                },
                400,
              ),
              shopper,
            );
          }
          manualQuery = manualInput.data.query;
          input = manualSearchInput(manualQuery);
        }

        // Only enforce the paid-provider quota when SerpApi is configured. The
        // local mock fallback remains free for development and outages.
        if (process.env.SERPAPI_API_KEY?.trim()) {
          const quota = await consumeApiQuota({
            profileId: shopper.id,
            action: "product_search",
            limit: PRODUCT_SEARCH_LIMIT,
            windowSeconds: PRODUCT_SEARCH_WINDOW_SECONDS,
          });
          if (!quota.allowed) {
            return attachAnonymousShopperCookie(
              quotaExceededResponse(
                quota,
                "You have reached the hourly product-search limit. Please try again later.",
              ),
              shopper,
            );
          }
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
          const rankedProducts = await rankProductSearchResults(
            providerResponse.products,
            shopper.id,
          );
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

        const resultResponse =
          manualQuery !== null
            ? jsonResponse(
                { ...response, searchId: manualSearchId },
                "error" in response ? 502 : 200,
              )
            : jsonResponse(response, "error" in response ? 502 : 200);

        return attachAnonymousShopperCookie(resultResponse, shopper);
      },
    },
  },
});
