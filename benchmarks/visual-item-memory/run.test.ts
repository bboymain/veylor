import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { loadVisualManifest, runVisualBenchmark, runVisualBenchmarkIntegrated } from "./run";
import { createDeterministicMockProvider } from "./provider";
import {
  createVisualBenchmarkIdempotency,
  InMemoryVisualBenchmarkPersistence,
} from "./persistence";
import type { VisualBenchmarkConfig, VisualProviderMetadata } from "./schema";

const EXAMPLE_MANIFEST_PATH = fileURLToPath(new URL("./manifest.example.json", import.meta.url));

const CONFIG: VisualBenchmarkConfig = {
  topK: 3,
  thresholds: [0.5, 0.8, 0.92],
  batchSize: 8,
};

describe("visual benchmark runner with the mock provider", () => {
  test("same-item mock embeddings rank first in every case that has one", async () => {
    const manifest = loadVisualManifest(EXAMPLE_MANIFEST_PATH);
    const run = await runVisualBenchmark(manifest, createDeterministicMockProvider(), CONFIG);

    expect(run.metrics.failedCases).toBe(0);
    expect(run.metrics.top1Accuracy).toBe(1);
    expect(run.metrics.sameItemRecallAtK).toBe(1);
    expect(run.provider.provider).toBe("mock");
    expect(run.provider.embeddingDimension).toBe(32);
    expect(run.latency.images).toBe(
      manifest.cases.reduce((sum, benchmarkCase) => sum + benchmarkCase.candidates.length + 1, 0),
    );
  });

  test("similar-but-different items never count as exact matches at a separating threshold", async () => {
    const manifest = loadVisualManifest(EXAMPLE_MANIFEST_PATH);
    const run = await runVisualBenchmark(manifest, createDeterministicMockProvider(), CONFIG);

    const separating = run.metrics.thresholdSweep.find((entry) => entry.threshold === 0.92);
    expect(separating).toBeDefined();
    expect(separating!.falsePositiveRate).toBe(0);
    expect(separating!.sameItemRecall).toBe(1);
    expect(separating!.predictedPositiveByRelationship.visually_similar_but_different).toBe(0);
    expect(separating!.predictedPositiveByRelationship.different_item).toBe(0);

    // The permissive 0.8 threshold shows why sweeps matter: lookalikes and
    // colorways start crossing it while every same-item pair still passes.
    const permissive = run.metrics.thresholdSweep.find((entry) => entry.threshold === 0.8);
    expect(permissive!.falsePositiveRate).toBeGreaterThan(0);
    expect(permissive!.sameItemRecall).toBe(1);
  });

  test("unrelated items stay far below every configured threshold", async () => {
    const manifest = loadVisualManifest(EXAMPLE_MANIFEST_PATH);
    const run = await runVisualBenchmark(manifest, createDeterministicMockProvider(), CONFIG);

    for (const evaluation of run.caseEvaluations) {
      const benchmarkCase = manifest.cases.find((c) => c.id === evaluation.caseId)!;
      for (const entry of evaluation.candidateSimilarities) {
        const candidate = benchmarkCase.candidates.find((c) => c.id === entry.candidateId)!;
        if (candidate.expectedRelationship === "different_item" && /unrelated/.test(candidate.id)) {
          expect(entry.similarity).not.toBeNull();
          expect(entry.similarity!).toBeLessThan(0.5);
        }
        if (candidate.expectedRelationship === "same_item") {
          expect(entry.similarity!).toBeGreaterThan(0.92);
        }
      }
    }
  });

  test("per-condition metrics cover all ten scenario conditions", async () => {
    const manifest = loadVisualManifest(EXAMPLE_MANIFEST_PATH);
    const run = await runVisualBenchmark(manifest, createDeterministicMockProvider(), CONFIG);
    expect(Object.keys(run.metrics.perCondition).sort()).toEqual([
      "different_angle",
      "different_colorway",
      "different_crop",
      "different_lighting_background",
      "different_photo",
      "lookalike_product",
      "low_resolution",
      "partial_occlusion",
      "same_brand_different_model",
      "unrelated",
    ]);
    expect(Object.keys(run.metrics.perCategory).sort()).toEqual(["handbag", "jacket", "sneaker"]);
  });

  test("provider failures are captured safely without aborting the run", async () => {
    const manifest = loadVisualManifest(EXAMPLE_MANIFEST_PATH);
    const provider = createDeterministicMockProvider({
      failImageIds: ["jacket-a-different-photo/query", "sneaker-b-lookalike/same-item-reshoot"],
    });
    const run = await runVisualBenchmark(manifest, provider, CONFIG);

    const failedCase = run.caseEvaluations.find(
      (evaluation) => evaluation.caseId === "jacket-a-different-photo",
    )!;
    expect(failedCase.status).toBe("query_failed");
    expect(run.metrics.failedCases).toBe(1);

    const partialCase = run.caseEvaluations.find(
      (evaluation) => evaluation.caseId === "sneaker-b-lookalike",
    )!;
    expect(partialCase.status).toBe("evaluated");
    expect(partialCase.failures).toHaveLength(1);

    for (const failure of run.failures) {
      expect(failure.length).toBeLessThan(400);
      expect(failure).not.toContain("apikey");
      expect(failure).not.toContain("Bearer");
    }
  });

  test("a throwing provider fails the batch but never the run", async () => {
    const manifest = loadVisualManifest(EXAMPLE_MANIFEST_PATH);
    const provider = {
      ...createDeterministicMockProvider(),
      embedBatch: () => Promise.reject(new Error("connection torched   with    whitespace")),
    };
    const run = await runVisualBenchmark(manifest, provider, CONFIG);
    expect(run.metrics.evaluatedCases).toBe(0);
    expect(run.metrics.failedCases).toBe(manifest.cases.length);
    expect(run.failures[0]).toContain("connection torched with whitespace");
  });

  test("embeddings with the wrong dimension are rejected as failures", async () => {
    const manifest = loadVisualManifest(EXAMPLE_MANIFEST_PATH);
    const base = createDeterministicMockProvider();
    const provider = {
      ...base,
      embedBatch: async (inputs: Parameters<typeof base.embedBatch>[0]) => {
        const results = await base.embedBatch(inputs);
        return results.map((result, index) =>
          index === 0 && result.embedding !== null
            ? { ...result, embedding: result.embedding.slice(0, 8) }
            : result,
        );
      },
    };
    const run = await runVisualBenchmark(manifest, provider, CONFIG);
    expect(run.failures.some((failure) => failure.includes("dimension"))).toBe(true);
  });

  test("rejects invalid configurations before embedding anything", async () => {
    const manifest = loadVisualManifest(EXAMPLE_MANIFEST_PATH);
    const provider = createDeterministicMockProvider();
    await expect(runVisualBenchmark(manifest, provider, { ...CONFIG, topK: 0 })).rejects.toThrow(
      "topK",
    );
    await expect(
      runVisualBenchmark(manifest, provider, { ...CONFIG, thresholds: [] }),
    ).rejects.toThrow("thresholds");
    await expect(
      runVisualBenchmark(manifest, provider, { ...CONFIG, thresholds: [2] }),
    ).rejects.toThrow("cosine");
    await expect(
      runVisualBenchmark(manifest, provider, { ...CONFIG, batchSize: 0 }),
    ).rejects.toThrow("batchSize");
  });
});

describe("persistence, idempotency, and dry-run guarantees", () => {
  const metadata: VisualProviderMetadata = {
    provider: "mock",
    model: "deterministic-mock-embedding",
    modelVersion: "1",
    embeddingDimension: 32,
  };

  test("dry-run performs zero persistence interactions", async () => {
    const manifest = loadVisualManifest(EXAMPLE_MANIFEST_PATH);
    const persistence = new InMemoryVisualBenchmarkPersistence();
    const { persistence: outcome } = await runVisualBenchmarkIntegrated(
      manifest,
      createDeterministicMockProvider(),
      CONFIG,
      persistence,
      { dryRun: true },
    );
    expect(outcome.dryRun).toBe(true);
    expect(outcome.writesPerformed).toBe(0);
    expect(persistence.writeCalls).toBe(0);
    expect(persistence.statusCalls).toBe(0);
    expect(persistence.saved.size).toBe(0);
  });

  test("stable idempotency keys prevent duplicate submissions", async () => {
    const manifest = loadVisualManifest(EXAMPLE_MANIFEST_PATH);
    const persistence = new InMemoryVisualBenchmarkPersistence();
    const provider = createDeterministicMockProvider();

    const first = await runVisualBenchmarkIntegrated(manifest, provider, CONFIG, persistence);
    expect(first.persistence.alreadyCompleted).toBe(false);
    expect(first.persistence.writesPerformed).toBe(1);
    expect(persistence.saved.size).toBe(1);

    const second = await runVisualBenchmarkIntegrated(manifest, provider, CONFIG, persistence);
    expect(second.persistence.alreadyCompleted).toBe(true);
    expect(second.persistence.writesPerformed).toBe(0);
    expect(second.persistence.runId).toBe(first.persistence.runId);
    expect(persistence.saved.size).toBe(1);
  });

  test("identity changes with configuration, provider, and explicit keys", () => {
    const manifest = loadVisualManifest(EXAMPLE_MANIFEST_PATH);
    const base = createVisualBenchmarkIdempotency(manifest, metadata, CONFIG);
    expect(createVisualBenchmarkIdempotency(manifest, metadata, CONFIG)).toEqual(base);

    const differentTopK = createVisualBenchmarkIdempotency(manifest, metadata, {
      ...CONFIG,
      topK: 5,
    });
    expect(differentTopK.runId).not.toBe(base.runId);

    const differentModel = createVisualBenchmarkIdempotency(
      manifest,
      { ...metadata, modelVersion: "2" },
      CONFIG,
    );
    expect(differentModel.runId).not.toBe(base.runId);

    const explicit = createVisualBenchmarkIdempotency(manifest, metadata, CONFIG, "my-key");
    expect(explicit.runId).not.toBe(base.runId);
    expect(createVisualBenchmarkIdempotency(manifest, metadata, CONFIG, "my-key")).toEqual(
      explicit,
    );

    expect(base.runId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test("failures are stored inside the persisted payload, sanitized", async () => {
    const manifest = loadVisualManifest(EXAMPLE_MANIFEST_PATH);
    const persistence = new InMemoryVisualBenchmarkPersistence();
    const provider = createDeterministicMockProvider({
      failImageIds: ["handbag-c-low-resolution/query"],
    });
    const { persistence: outcome } = await runVisualBenchmarkIntegrated(
      manifest,
      provider,
      CONFIG,
      persistence,
    );
    const stored = persistence.saved.get(outcome.runId) as {
      failures: string[];
      metrics: { failedCases: number };
    };
    expect(stored.metrics.failedCases).toBe(1);
    expect(stored.failures).toHaveLength(1);
    expect(stored.failures[0]).toContain("handbag-c-low-resolution");
  });
});
