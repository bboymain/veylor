import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
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

        // Preserve the legacy click fields while applying the Stage 10
        // relationship-scoped verification rule through one server-only RPC.
        // Both writes are best-effort because the merchant link has already
        // opened and must never depend on analytics availability.
        const [saved, verification] = await Promise.all([
          recordProductClick(input.data),
          verifyProductClickEvidence({
            searchId: input.data.searchId,
            productUrl: input.data.productUrl,
          }),
        ]);

        return jsonResponse({ success: saved, verification });
      },
    },
  },
});
