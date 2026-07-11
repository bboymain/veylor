import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
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
        const contentType = request.headers.get("content-type") ?? "";
        if (!contentType.includes("application/json")) {
          return jsonResponse(
            { error: { code: "INVALID_REQUEST", message: "Expected a JSON request." } },
            415,
          );
        }

        const input = ProductClickInputSchema.safeParse(await request.json());
        if (!input.success) {
          return jsonResponse(
            { error: { code: "INVALID_REQUEST", message: "Invalid product-click input." } },
            400,
          );
        }

        // Best-effort: the product link already opened in a new tab regardless
        // of whether this write succeeds, so always answer 200.
        const saved = await recordProductClick(input.data);

        // Also mark the matching alternatives row (phase 7) when the product
        // can be resolved by normalized URL. Additive: never blocks the
        // response, and the searches-table click fields above are kept.
        await recordAlternativeClick({
          searchId: input.data.searchId,
          productUrl: input.data.productUrl,
        });

        return jsonResponse({ success: saved });
      },
    },
  },
});
