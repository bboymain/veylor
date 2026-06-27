import { createFileRoute } from "@tanstack/react-router";
import {
  analyzeFashionWithOllama,
  getOllamaConfig,
  jsonResponse,
  mapOllamaError,
  parseDataUrlImage,
  publicOllamaError,
} from "@/lib/ollama-fashion";

function localEnv() {
  return typeof process === "undefined" ? {} : process.env;
}

export const Route = createFileRoute("/api/ollama-fashion")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const contentType = request.headers.get("content-type") ?? "";
          if (!contentType.includes("application/json")) {
            return publicOllamaError("Expected a JSON request.", 415, "INVALID_REQUEST");
          }

          const body = (await request.json()) as { imageDataUrl?: unknown };
          if (typeof body.imageDataUrl !== "string") {
            return publicOllamaError("Missing image data.", 400, "INVALID_IMAGE");
          }

          const image = parseDataUrlImage(body.imageDataUrl);
          const config = getOllamaConfig(localEnv());
          const result = await analyzeFashionWithOllama(image.base64, config);

          if (!result.category || result.confidence < 0.18) {
            return publicOllamaError(
              "The model could not confidently detect a fashion item.",
              422,
              "NO_FASHION_ITEM",
            );
          }

          return jsonResponse({
            result,
            image: { mimeType: image.mimeType, byteLength: image.byteLength },
          });
        } catch (error) {
          const config = getOllamaConfig(localEnv());
          return mapOllamaError(error, config.model);
        }
      },
    },
  },
});
