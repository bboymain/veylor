import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse } from "@/lib/fashion-scan";
import {
  executeProductSearch,
  mockProductSearchProvider,
  ProductSearchInputSchema,
} from "@/lib/product-search-provider";

export const Route = createFileRoute("/api/product-search")({
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

        const input = ProductSearchInputSchema.safeParse(await request.json());
        if (!input.success) {
          return jsonResponse(
            { error: { code: "INVALID_REQUEST", message: "Invalid product-search input." } },
            400,
          );
        }

        const response = await executeProductSearch(mockProductSearchProvider, input.data);
        return jsonResponse(response, "error" in response ? 502 : 200);
      },
    },
  },
});
