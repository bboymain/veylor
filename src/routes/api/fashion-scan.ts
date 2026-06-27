import { createFileRoute } from "@tanstack/react-router";
import { analyzeFashionWithGemini, mapGeminiError } from "@/lib/gemini-fashion";
import { getAiProvider, ollamaResultToFashionScanResult } from "@/lib/fashion-scan";
import { parseDataUrlImage } from "@/lib/image-data";
import {
  analyzeFashionWithOllama,
  getOllamaConfig,
  jsonResponse,
  mapOllamaError,
  publicOllamaError,
} from "@/lib/ollama-fashion";

type ServerEnv = Record<string, string | undefined>;

function serverEnv(): ServerEnv {
  return typeof process === "undefined" ? {} : process.env;
}

export const Route = createFileRoute("/api/fashion-scan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const env = serverEnv();
        const provider = getAiProvider(env);

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

          if (provider === "local") {
            const config = getOllamaConfig(env);
            const ollamaResult = await analyzeFashionWithOllama(image.base64, config);
            const result = ollamaResultToFashionScanResult(ollamaResult);

            if (result.items.length === 0 || result.items[0].confidence < 0.18) {
              return publicOllamaError(
                "The model could not confidently detect a fashion item.",
                422,
                "NO_FASHION_ITEM",
              );
            }

            return jsonResponse({
              provider,
              result,
              image: { mimeType: image.mimeType, byteLength: image.byteLength },
            });
          }

          const result = await analyzeFashionWithGemini(image, {
            apiKey: env.GEMINI_API_KEY,
          });

          if (result.items.length === 0) {
            return jsonResponse(
              {
                error: {
                  code: "NO_FASHION_ITEM",
                  message: "Gemini could not confidently detect a fashion item.",
                },
              },
              422,
            );
          }

          return jsonResponse({
            provider,
            result,
            image: { mimeType: image.mimeType, byteLength: image.byteLength },
          });
        } catch (error) {
          if (provider === "local") {
            const config = getOllamaConfig(env);
            return mapOllamaError(error, config.model);
          }

          return mapGeminiError(error);
        }
      },
    },
  },
});
