import { createFileRoute } from "@tanstack/react-router";
import { analyzeFashionWithGemini, GEMINI_MODEL, mapGeminiError } from "@/lib/gemini-fashion";
import { jsonResponse } from "@/lib/fashion-scan";
import { parseDataUrlImage } from "@/lib/image-data";
import { logScanAttempt } from "@/lib/search-logging.server";

type ServerEnv = Record<string, string | undefined>;

function serverEnv(): ServerEnv {
  return typeof process === "undefined" ? {} : process.env;
}

export const Route = createFileRoute("/api/fashion-scan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const env = serverEnv();

        try {
          const contentType = request.headers.get("content-type") ?? "";
          if (!contentType.includes("application/json")) {
            return jsonResponse(
              { error: { code: "INVALID_REQUEST", message: "Expected a JSON request." } },
              415,
            );
          }

          const body = (await request.json()) as { imageDataUrl?: unknown };
          if (typeof body.imageDataUrl !== "string") {
            return jsonResponse(
              { error: { code: "INVALID_IMAGE", message: "Missing image data." } },
              400,
            );
          }

          const image = parseDataUrlImage(body.imageDataUrl);

          const result = await analyzeFashionWithGemini(image, {
            apiKey: env.GEMINI_API_KEY,
          });

          if (result.items.length === 0) {
            const searchId = await logScanAttempt({
              status: "error",
              errorMessage: "No clothing or accessories were detected.",
            });
            return jsonResponse(
              {
                error: {
                  code: "NO_FASHION_ITEM",
                  message: "No clothing or accessories were detected. Try a clearer photo.",
                },
                searchId,
              },
              422,
            );
          }

          const strongestItem = result.items.reduce((best, item) =>
            item.confidence > best.confidence ? item : best,
          );
          const searchId = await logScanAttempt({
            status: "success",
            model: GEMINI_MODEL,
            summary: result.summary,
            detectedItems: result.items,
            primarySearchQuery: strongestItem.searchQueries[0] ?? "",
          });

          return jsonResponse({
            result,
            image: { mimeType: image.mimeType, byteLength: image.byteLength },
            searchId,
          });
        } catch (error) {
          const errorResponse = mapGeminiError(error);
          const errorPayload = (await errorResponse.clone().json()) as {
            error: { message: string };
          };
          await logScanAttempt({ status: "error", errorMessage: errorPayload.error.message });
          return errorResponse;
        }
      },
    },
  },
});
