import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  attachAnonymousShopperCookie,
  recordShopperPreferenceClick,
  resolveAnonymousShopper,
} from "@/lib/anonymous-shopper.server";
import { SearchIdSchema } from "@/lib/database-identifiers";
import { jsonResponse } from "@/lib/fashion-scan";
import { recordAlternativeClick } from "@/lib/product-persistence.server";
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

        // Both writes are interest/ranking signals only. They must never write
        // verification, authenticity, classification, cache, or identity fields.
        const [saved, alternativeSaved] = await Promise.all([
          recordProductClick(input.data),
          recordAlternativeClick({
            searchId: input.data.searchId,
            productUrl: input.data.productUrl,
          }),
        ]);

        // Preference learning is sequenced after the relationship-scoped
        // alternative interest write so only persisted clicks can contribute.
        const preferenceLearned = await recordShopperPreferenceClick({
          profileId: shopper.id,
          searchId: input.data.searchId,
          productUrl: input.data.productUrl,
        });

        return attachAnonymousShopperCookie(
          jsonResponse({ success: saved, alternativeSaved, preferenceLearned }),
          shopper,
        );
      },
    },
  },
});
