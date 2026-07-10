import { createFileRoute } from "@tanstack/react-router";
import { analyzeFashionWithGemini, mapGeminiError } from "@/lib/gemini-fashion";
import { jsonResponse } from "@/lib/fashion-scan";
import { parseDataUrlImage } from "@/lib/image-data";

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
            return jsonResponse(
              {
                error: {
                  code: "NO_FASHION_ITEM",
                  message: "No clothing or accessories were detected. Try a clearer photo.",
                },
              },
              422,
            );
          }

          return jsonResponse({
            result,
            image: { mimeType: image.mimeType, byteLength: image.byteLength },
          });
        } catch (error) {
          return mapGeminiError(error);
        }
      },
    },
  },
});
