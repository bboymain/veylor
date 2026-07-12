import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  attachAnonymousShopperCookie,
  recordShopperPreferenceClick,
  resolveAnonymousShopper,
} from "@/lib/anonymous-shopper.server";
import { SearchIdSchema } from "@/lib/database-identifiers";
import { jsonResponse } from "@/lib/fashion-scan";
import { verifyProductClickEvidence } from "@/lib/product-verification.server";
import { recordProductClick } from "@/lib/search-logging.server";

export const ProductClickInputSchema = z.object({
  searchId: SearchIdSchema,
  productUrl: z.string().min(1),
  productTitle: z.string().min(1),
  retailer: z.string().min(1),
  tier: z.string().min(1),
});

export const Route = createFileRoute("/api/product-click")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const shopper = resolveAnonymousShopper(request);
        const contentType = request.headers.get("content-type") ?? "";
        if (!contentType.includes("application/json")) {
          return attachAnonymousShopperCookie(
            jsonResponse(
              { error: { code: "INVALID_REQUEST", message: "Expected a JSON request." } },
              415,
            ),
            shopper,
          );
        }

        const input = ProductClickInputSchema.safeParse(await request.json());
        if (!input.success) {
          return attachAnonymousShopperCookie(
            jsonResponse(
              { error: { code: "INVALID_REQUEST", message: "Invalid product-click input." } },
              400,
            ),
            shopper,
          );
        }

        // Click logging is an interest/ranking signal only. It must not write
        // verification, authenticity, classification, cache, or identity fields;
        // the existing evidence-verification path remains separately governed.
        const [saved, verification] = await Promise.all([
          recordProductClick(input.data),
          verifyProductClickEvidence({
            searchId: input.data.searchId,
            productUrl: input.data.productUrl,
          }),
        ]);

        // Preference learning is intentionally sequenced after verification.
        // The database RPC independently requires the clicked alternative to
        // belong to this search and already be marked clicked.
        const preferenceLearned = await recordShopperPreferenceClick({
          profileId: shopper.id,
          searchId: input.data.searchId,
          productUrl: input.data.productUrl,
        });

        return attachAnonymousShopperCookie(
          jsonResponse({ success: saved, verification, preferenceLearned }),
          shopper,
        );
      },
    },
  },
});
