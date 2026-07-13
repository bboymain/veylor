import { readFileSync } from "node:fs";
import {
  parseVisualManifest,
  type VisualBenchmarkCase,
  type VisualBenchmarkConfig,
  type VisualBenchmarkManifest,
  type VisualProviderMetadata,
} from "./schema";
import type { EmbeddingInput, EmbeddingResult, VisualEmbeddingProvider } from "./provider";
import { sanitizeProviderError } from "./provider";
import {
  computeLatencyStats,
  computeMetrics,
  evaluateCase,
  type CaseEvaluation,
  type LatencyStats,
  type VisualBenchmarkMetrics,
} from "./evaluate";
import {
  persistVisualBenchmarkRun,
  type VisualBenchmarkPersistence,
  type VisualPersistenceOutcome,
} from "./persistence";

// Sequential runner for the PRIVATE visual item-memory benchmark. The
// embedding provider is always injected (tests use the deterministic mock);
// this module performs no network calls, no Supabase access, and no
// production writes of any kind.

export type VisualBenchmarkRunResult = {
  manifestName: string;
  manifestVersion: number;
  provider: VisualProviderMetadata & { supportsBatch: boolean };
  config: VisualBenchmarkConfig;
  startedAt: string;
  completedAt: string;
  caseEvaluations: CaseEvaluation[];
  metrics: VisualBenchmarkMetrics;
  latency: LatencyStats;
  /** Sanitized, per-image failure summaries; safe to store and print. */
  failures: string[];
};

/** Reads and validates a manifest file. Throws descriptive errors. */
export function loadVisualManifest(manifestPath: string): VisualBenchmarkManifest {
  let text: string;
  try {
    text = readFileSync(manifestPath, "utf8");
  } catch {
    throw new Error(`Visual benchmark manifest could not be read: ${manifestPath}`);
  }
  return parseVisualManifest(text);
}

function collectInputs(manifest: VisualBenchmarkManifest): EmbeddingInput[] {
  const inputs: EmbeddingInput[] = [];
  for (const benchmarkCase of manifest.cases) {
    inputs.push({ imageId: `${benchmarkCase.id}/query`, image: benchmarkCase.queryImage });
    for (const candidate of benchmarkCase.candidates) {
      inputs.push({ imageId: `${benchmarkCase.id}/${candidate.id}`, image: candidate.image });
    }
  }
  return inputs;
}

function chunk<Item>(items: readonly Item[], size: number): Item[][] {
  const chunks: Item[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function embedAll(
  provider: VisualEmbeddingProvider,
  inputs: readonly EmbeddingInput[],
  batchSize: number,
): Promise<Map<string, EmbeddingResult>> {
  const results = new Map<string, EmbeddingResult>();
  for (const batch of chunk(inputs, batchSize)) {
    let batchResults: EmbeddingResult[];
    const startedMs = performance.now();
    try {
      batchResults = await provider.embedBatch(batch);
    } catch (error) {
      // A throwing provider fails the whole batch, never the whole run.
      const elapsed = Math.max(0, performance.now() - startedMs) / batch.length;
      batchResults = batch.map((input) => ({
        imageId: input.imageId,
        embedding: null,
        latencyMs: elapsed,
        error: sanitizeProviderError(error),
      }));
    }
    for (const input of batch) {
      const result = batchResults.find((entry) => entry.imageId === input.imageId);
      if (result === undefined) {
        results.set(input.imageId, {
          imageId: input.imageId,
          embedding: null,
          latencyMs: 0,
          error: "Provider returned no result for this image.",
        });
        continue;
      }
      if (result.embedding !== null && result.embedding.length !== provider.dimension) {
        results.set(input.imageId, {
          imageId: input.imageId,
          embedding: null,
          latencyMs: result.latencyMs,
          error:
            `Provider returned dimension ${result.embedding.length}, ` +
            `expected ${provider.dimension}.`,
        });
        continue;
      }
      results.set(input.imageId, result);
    }
  }
  return results;
}

export function validateVisualConfig(config: VisualBenchmarkConfig): void {
  if (!Number.isInteger(config.topK) || config.topK < 1 || config.topK > 50) {
    throw new Error("topK must be an integer between 1 and 50.");
  }
  if (config.thresholds.length === 0 || config.thresholds.length > 200) {
    throw new Error("Between 1 and 200 sweep thresholds are required.");
  }
  if (config.thresholds.some((value) => !Number.isFinite(value) || value < -1 || value > 1)) {
    throw new Error("Sweep thresholds must be finite cosine values between -1 and 1.");
  }
  if (!Number.isInteger(config.batchSize) || config.batchSize < 1 || config.batchSize > 256) {
    throw new Error("batchSize must be an integer between 1 and 256.");
  }
}

export async function runVisualBenchmark(
  manifest: VisualBenchmarkManifest,
  provider: VisualEmbeddingProvider,
  config: VisualBenchmarkConfig,
): Promise<VisualBenchmarkRunResult> {
  validateVisualConfig(config);
  const startedAt = new Date().toISOString();

  const inputs = collectInputs(manifest);
  const embeddings = await embedAll(provider, inputs, config.batchSize);

  const lookup = (imageId: string): number[] | null => embeddings.get(imageId)?.embedding ?? null;
  const errorFor = (imageId: string): string | null => embeddings.get(imageId)?.error ?? null;

  const caseEvaluations = manifest.cases.map((benchmarkCase: VisualBenchmarkCase) =>
    evaluateCase(benchmarkCase, lookup, errorFor),
  );

  const failures: string[] = [];
  for (const evaluation of caseEvaluations) {
    for (const failure of evaluation.failures) {
      failures.push(`${evaluation.caseId}: ${failure}`);
    }
  }

  return {
    manifestName: manifest.name,
    manifestVersion: manifest.version,
    provider: {
      provider: provider.name,
      model: provider.model,
      modelVersion: provider.modelVersion,
      embeddingDimension: provider.dimension,
      supportsBatch: provider.supportsBatch,
    },
    config,
    startedAt,
    completedAt: new Date().toISOString(),
    caseEvaluations,
    metrics: computeMetrics(manifest, caseEvaluations, config),
    latency: computeLatencyStats(
      [...embeddings.values()].map((result) => result.latencyMs).filter((ms) => ms >= 0),
    ),
    failures,
  };
}

export async function runVisualBenchmarkIntegrated(
  manifest: VisualBenchmarkManifest,
  provider: VisualEmbeddingProvider,
  config: VisualBenchmarkConfig,
  persistence: VisualBenchmarkPersistence,
  options: { dryRun?: boolean; idempotencyKey?: string } = {},
): Promise<{ run: VisualBenchmarkRunResult; persistence: VisualPersistenceOutcome }> {
  const run = await runVisualBenchmark(manifest, provider, config);
  const metadata: VisualProviderMetadata = {
    provider: provider.name,
    model: provider.model,
    modelVersion: provider.modelVersion,
    embeddingDimension: provider.dimension,
  };
  const persistenceOutcome = await persistVisualBenchmarkRun(
    manifest,
    metadata,
    config,
    run,
    persistence,
    { dryRun: options.dryRun ?? false, idempotencyKey: options.idempotencyKey },
  );
  return { run, persistence: persistenceOutcome };
}
