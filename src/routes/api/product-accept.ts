import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SearchIdSchema } from "@/lib/database-identifiers";
import { jsonResponse } from "@/lib/fashion-scan";
import { acceptProductMatch } from "@/lib/product-acceptance.server";
import { normalizeProductUrl } from "@/lib/product-persistence.server";

export const ProductAcceptInputSchema = z.object({
  searchId: SearchIdSchema,
  productUrl: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .refine((value) => normalizeProductUrl(value) !== null),
});

function invalidRequestResponse() {
  return jsonResponse(
    { error: { code: "INVALID_REQUEST", message: "Invalid product-accept input." } },
    400,
  );
}

export const Route = createFileRoute("/api/product-accept")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const contentType = request.headers.get("content-type") ?? "";
        if (!contentType.includes("application/json")) return invalidRequestResponse();

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return invalidRequestResponse();
        }

        const input = ProductAcceptInputSchema.safeParse(body);
        if (!input.success) return invalidRequestResponse();

        const result = await acceptProductMatch(input.data);
        if (result === "accepted") return jsonResponse({ accepted: true }, 200);
        if (result === "not_found") {
          return jsonResponse(
            {
              error: {
                code: "MATCH_NOT_FOUND",
                message: "This search result is no longer available to confirm.",
              },
            },
            404,
          );
        }
        if (result === "invalid") return invalidRequestResponse();

        return jsonResponse(
          {
            error: {
              code: "ACCEPTANCE_FAILED",
              message: "The match could not be confirmed. Please try again.",
            },
          },
          500,
        );
      },
    },
  },
});
