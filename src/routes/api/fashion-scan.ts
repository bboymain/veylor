import { createFileRoute } from "@tanstack/react-router";
import { consumeApiQuota, quotaExceededResponse } from "@/lib/api-quota.server";
import {
  attachAnonymousShopperCookie,
  resolveAnonymousShopper,
} from "@/lib/anonymous-shopper.server";
import { analyzeFashionWithGemini, GEMINI_MODEL, mapGeminiError } from "@/lib/gemini-fashion";
import { jsonResponse } from "@/lib/fashion-scan";
import { parseDataUrlImage } from "@/lib/image-data";
import {
  findVerifiedScanCacheHit,
  fingerprintImage,
  markVerifiedScanCacheHit,
} from "@/lib/scan-cache.server";
import { logScanAttempt } from "@/lib/search-logging.server";

type ServerEnv = Record<string, string | undefined>;

const GEMINI_SCAN_LIMIT = 12;
const GEMINI_SCAN_WINDOW_SECONDS = 60 * 60;

function serverEnv(): ServerEnv {
  return typeof process === "undefined" ? {} : process.env;
}

export const Route = createFileRoute("/api/fashion-scan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const env = serverEnv();
        const shopper = resolveAnonymousShopper(request);
        let imageSha256: string | undefined;

        try {
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

          const body = (await request.json()) as { imageDataUrl?: unknown };
          if (typeof body.imageDataUrl !== "string") {
            return attachAnonymousShopperCookie(
              jsonResponse(
                { error: { code: "INVALID_IMAGE", message: "Missing image data." } },
                400,
              ),
              shopper,
            );
          }

          const image = parseDataUrlImage(body.imageDataUrl);
          imageSha256 = fingerprintImage(image);

          // Verified cache hits are free and never consume paid Gemini quota.
          const cacheHit = await findVerifiedScanCacheHit(imageSha256);
          if (cacheHit) {
            const strongestItem = cacheHit.result.items.reduce((best, item) =>
              item.confidence > best.confidence ? item : best,
            );
            const searchId = await logScanAttempt({
              status: "success",
              model: `cache:${cacheHit.sourceModel}`,
              summary: cacheHit.result.summary,
              detectedItems: cacheHit.result.items,
              primarySearchQuery: strongestItem.searchQueries[0] ?? "",
              imageSha256,
              cacheSourceSearchId: cacheHit.sourceSearchId,
            });
            await markVerifiedScanCacheHit(cacheHit.sourceSearchId);

            return attachAnonymousShopperCookie(
              jsonResponse({
                result: cacheHit.result,
                image: { mimeType: image.mimeType, byteLength: image.byteLength },
                searchId,
                cache: { hit: true },
              }),
              shopper,
            );
          }

          const quota = await consumeApiQuota({
            profileId: shopper.id,
            action: "gemini_scan",
            limit: GEMINI_SCAN_LIMIT,
            windowSeconds: GEMINI_SCAN_WINDOW_SECONDS,
          });
          if (!quota.allowed) {
            return attachAnonymousShopperCookie(
              quotaExceededResponse(
                quota,
                "You have reached the hourly scan limit. Please try again later.",
              ),
              shopper,
            );
          }

          const result = await analyzeFashionWithGemini(image, {
            apiKey: env.GEMINI_API_KEY,
          });

          if (result.items.length === 0) {
            const searchId = await logScanAttempt({
              status: "error",
              errorMessage: "No clothing or accessories were detected.",
              imageSha256,
            });
            return attachAnonymousShopperCookie(
              jsonResponse(
                {
                  error: {
                    code: "NO_FASHION_ITEM",
                    message: "No clothing or accessories were detected. Try a clearer photo.",
                  },
                  searchId,
                },
                422,
              ),
              shopper,
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
            imageSha256,
          });

          return attachAnonymousShopperCookie(
            jsonResponse({
              result,
              image: { mimeType: image.mimeType, byteLength: image.byteLength },
              searchId,
              cache: { hit: false },
            }),
            shopper,
          );
        } catch (error) {
          const errorResponse = mapGeminiError(error);
          const errorPayload = (await errorResponse.clone().json()) as {
            error: { message: string };
          };
          await logScanAttempt({
            status: "error",
            errorMessage: errorPayload.error.message,
            imageSha256,
          });
          return attachAnonymousShopperCookie(errorResponse, shopper);
        }
      },
    },
  },
});
