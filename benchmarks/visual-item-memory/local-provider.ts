import { readFileSync } from "node:fs";
import { extname } from "node:path";
import {
  sanitizeProviderError,
  normalizeVector,
  type EmbeddingInput,
  type EmbeddingResult,
  type VisualEmbeddingProvider,
} from "./provider";

// OPTIONAL, EXPERIMENTAL local embedding provider for the PRIVATE Stage 2A
// benchmark. It talks to an embedding server that is ALREADY RUNNING on the
// developer's own machine (for example Ollama or another localhost endpoint
// that accepts base64 images and returns embeddings).
//
// Hard rules, enforced here:
// - localhost-only: any non-loopback URL is rejected, so this can never call
//   a hosted/paid API.
// - never used by automated tests or CI; it exists behind the explicit
//   `--provider local` CLI flag only.
// - never downloads a model; if the local server or model is missing, the
//   run reports per-image errors and exits non-zero.
// - never bundled into production code paths (nothing under src/ imports it).

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export type LocalProviderOptions = {
  /** Base URL of the local embedding server. Must be loopback. */
  baseUrl?: string;
  /** Local model name, e.g. an Ollama vision-embedding model tag. */
  model: string;
  modelVersion?: string;
  /** Expected embedding dimension; validated against responses. */
  dimension: number;
  timeoutMs?: number;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
};

export function assertLoopbackUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Local provider URL is not a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Local provider URL must use http or https.");
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(
      "The local provider only accepts loopback URLs (localhost / 127.0.0.1 / ::1). " +
        "Remote or hosted embedding endpoints are not permitted in this benchmark.",
    );
  }
  return parsed;
}

function readImageAsDataUrl(path: string): string {
  const mimeType = IMAGE_MIME_BY_EXTENSION[extname(path).toLowerCase()];
  if (!mimeType) {
    throw new Error(`Unsupported local benchmark image type: ${extname(path) || "none"}`);
  }
  const bytes = readFileSync(path);
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

type LocalEmbedResponse = { embeddings?: unknown };

/**
 * Creates the localhost-only embedding provider. The request contract is one
 * POST per batch to `<baseUrl>/api/embed` with `{ model, input: dataUrl[] }`,
 * expecting `{ embeddings: number[][] }` in input order. Adjust the endpoint
 * server-side; this client is deliberately minimal and never retries.
 */
export function createLocalEmbeddingProvider(
  options: LocalProviderOptions,
): VisualEmbeddingProvider {
  const baseUrl = assertLoopbackUrl(options.baseUrl ?? "http://127.0.0.1:11434");
  const model = options.model.trim();
  if (!model) throw new Error("A local model name is required for the local provider.");
  if (!Number.isInteger(options.dimension) || options.dimension < 2) {
    throw new Error("The local provider requires the expected embedding dimension.");
  }
  const timeoutMs = options.timeoutMs ?? 60_000;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    name: "local",
    model,
    modelVersion: options.modelVersion?.trim() || "unversioned-local",
    dimension: options.dimension,
    supportsBatch: true,
    embedBatch: async (inputs: readonly EmbeddingInput[]): Promise<EmbeddingResult[]> => {
      const startedMs = performance.now();
      const failAll = (message: string): EmbeddingResult[] => {
        const perImage = Math.max(0, performance.now() - startedMs) / Math.max(1, inputs.length);
        return inputs.map((input) => ({
          imageId: input.imageId,
          embedding: null,
          latencyMs: perImage,
          error: message,
        }));
      };

      let dataUrls: string[];
      try {
        dataUrls = inputs.map((input) => {
          if (input.image.path === null) {
            throw new Error(
              `Image ${input.imageId} has no file path; the local provider needs real files.`,
            );
          }
          return readImageAsDataUrl(input.image.path);
        });
      } catch (error) {
        return failAll(sanitizeProviderError(error));
      }

      let response: Response;
      try {
        response = await fetchImpl(new URL("/api/embed", baseUrl), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model, input: dataUrls }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        return failAll(
          `Local embedding server unreachable (${sanitizeProviderError(error)}). ` +
            "Start your local server and install the model manually; nothing is downloaded.",
        );
      }
      if (!response.ok) {
        return failAll(`Local embedding server responded ${response.status}.`);
      }

      let payload: LocalEmbedResponse;
      try {
        payload = (await response.json()) as LocalEmbedResponse;
      } catch {
        return failAll("Local embedding server returned invalid JSON.");
      }
      const embeddings = payload.embeddings;
      if (!Array.isArray(embeddings) || embeddings.length !== inputs.length) {
        return failAll("Local embedding server returned a mismatched embeddings array.");
      }

      const perImage = Math.max(0, performance.now() - startedMs) / inputs.length;
      return inputs.map((input, index) => {
        const raw = embeddings[index];
        if (
          !Array.isArray(raw) ||
          raw.length !== options.dimension ||
          raw.some((value) => typeof value !== "number" || !Number.isFinite(value))
        ) {
          return {
            imageId: input.imageId,
            embedding: null,
            latencyMs: perImage,
            error: "Local embedding had the wrong shape or dimension.",
          };
        }
        const normalized = normalizeVector(raw as number[]);
        return {
          imageId: input.imageId,
          embedding: normalized,
          latencyMs: perImage,
          error: normalized === null ? "Local embedding had zero norm." : null,
        };
      });
    },
  };
}
