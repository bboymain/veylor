import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonResponse } from "@/lib/fashion-scan";
import { recordProductClick } from "@/lib/search-logging.server";

const ProductClickInputSchema = z.object({
  searchId: z.string().min(1),
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
        return jsonResponse({ success: saved });
      },
    },
  },
});
