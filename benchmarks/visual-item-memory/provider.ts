import { createHash } from "node:crypto";
import type { ImageRef } from "./schema";

// Injectable visual embedding provider abstraction for the PRIVATE Stage 2A
// benchmark. Providers are always injected by the caller; nothing in this
// module (or the runner) instantiates a live network provider. All automated
// tests use the deterministic mock provider below — no Gemini, OpenAI,
// SerpApi, hosted embedding, or other paid model calls exist in this suite.

export type EmbeddingInput = {
  /** Stable image id, unique within one run (e.g. "case-1/query"). */
  imageId: string;
  image: ImageRef;
};

export type EmbeddingResult = {
  imageId: string;
  /** Unit-normalized embedding vector, or null when this image failed. */
  embedding: number[] | null;
  /** Wall-clock milliseconds spent producing this embedding. */
  latencyMs: number;
  /** Sanitized failure summary; never raw provider payloads or secrets. */
  error: string | null;
};

export type VisualEmbeddingProvider = {
  /** Short label recorded in run output, e.g. "mock". */
  name: string;
  model: string;
  modelVersion: string;
  /** Output embedding dimension; every returned vector must match it. */
  dimension: number;
  /** Whether embedBatch benefits from batching (recorded in run output). */
  supportsBatch: boolean;
  /**
   * Embeds a batch of images. Must resolve with one result per input, in
   * input order, and must report per-image failures instead of throwing.
   */
  embedBatch: (inputs: readonly EmbeddingInput[]) => Promise<EmbeddingResult[]>;
};

export function sanitizeProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 300) || "Unknown provider error.";
}

function norm(vector: readonly number[]): number {
  let sum = 0;
  for (const value of vector) sum += value * value;
  return Math.sqrt(sum);
}

/** Returns a unit-normalized copy, or null when the vector has zero norm. */
export function normalizeVector(vector: readonly number[]): number[] | null {
  const magnitude = norm(vector);
  if (!Number.isFinite(magnitude) || magnitude === 0) return null;
  return vector.map((value) => value / magnitude);
}

/**
 * Expands an authored mock signature into a fixed-dimension vector by cycling
 * signature values with a deterministic positional decay. Nearby signatures
 * stay nearby after expansion, which is what the benchmark fixtures rely on.
 */
export function expandSignature(signature: readonly number[], dimension: number): number[] {
  const expanded = new Array<number>(dimension);
  for (let index = 0; index < dimension; index += 1) {
    const value = signature[index % signature.length];
    const cycle = Math.floor(index / signature.length);
    expanded[index] = value / (1 + cycle);
  }
  return expanded;
}

/**
 * Deterministic pseudo-random unit vector derived from a seed string. Used
 * for images without an authored signature so that repeated runs are stable.
 */
export function seededUnitVector(seed: string, dimension: number): number[] {
  const values: number[] = [];
  let counter = 0;
  while (values.length < dimension) {
    const digest = createHash("sha256").update(`${seed}#${counter}`).digest();
    for (let offset = 0; offset + 4 <= digest.length && values.length < dimension; offset += 4) {
      const raw = digest.readUInt32BE(offset);
      values.push(raw / 0xffffffff - 0.5);
    }
    counter += 1;
  }
  const normalized = normalizeVector(values);
  // A sha256-derived vector cannot be all zeros, but keep a defensive fallback.
  if (normalized === null) {
    const fallback = new Array<number>(dimension).fill(0);
    fallback[0] = 1;
    return fallback;
  }
  return normalized;
}

export const MOCK_PROVIDER_NAME = "mock";
export const MOCK_PROVIDER_MODEL = "deterministic-mock-embedding";
export const MOCK_PROVIDER_MODEL_VERSION = "1";
export const MOCK_PROVIDER_DIMENSION = 32;

export type MockProviderOptions = {
  dimension?: number;
  /** Image ids that should fail deterministically (for failure-path tests). */
  failImageIds?: readonly string[];
};

/**
 * Deterministic mock embedding provider.
 *
 * - Images with an authored mockSignature embed to the expanded, normalized
 *   signature, so fixture authors control the similarity structure exactly.
 * - Images without a signature embed to a seeded pseudo-random unit vector
 *   derived from their path, which is stable across runs and effectively
 *   orthogonal to authored fixtures.
 * - Never touches the filesystem or network; latency is measured, not faked.
 */
export function createDeterministicMockProvider(
  options: MockProviderOptions = {},
): VisualEmbeddingProvider {
  const dimension = options.dimension ?? MOCK_PROVIDER_DIMENSION;
  if (!Number.isInteger(dimension) || dimension < 2 || dimension > 4096) {
    throw new Error("Mock provider dimension must be an integer between 2 and 4096.");
  }
  const failIds = new Set(options.failImageIds ?? []);

  return {
    name: MOCK_PROVIDER_NAME,
    model: MOCK_PROVIDER_MODEL,
    modelVersion: MOCK_PROVIDER_MODEL_VERSION,
    dimension,
    supportsBatch: true,
    embedBatch: (inputs) => {
      const results: EmbeddingResult[] = [];
      for (const input of inputs) {
        const startedMs = performance.now();
        if (failIds.has(input.imageId)) {
          results.push({
            imageId: input.imageId,
            embedding: null,
            latencyMs: Math.max(0, performance.now() - startedMs),
            error: "Mock provider was configured to fail this image.",
          });
          continue;
        }
        let embedding: number[] | null;
        if (input.image.mockSignature !== null) {
          embedding = normalizeVector(expandSignature(input.image.mockSignature, dimension));
        } else {
          embedding = seededUnitVector(input.image.path ?? input.imageId, dimension);
        }
        results.push({
          imageId: input.imageId,
          embedding,
          latencyMs: Math.max(0, performance.now() - startedMs),
          error: embedding === null ? "Mock signature produced a zero-norm vector." : null,
        });
      }
      return Promise.resolve(results);
    },
  };
}
