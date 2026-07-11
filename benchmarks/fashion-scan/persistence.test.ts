import { describe, expect, test } from "bun:test";
import type { BenchmarkManifest, BenchmarkRunResult } from "./schema";
import {
  createBenchmarkIdempotency,
  persistBenchmarkRun,
  type BenchmarkPersistence,
  type PersistedRunState,
} from "./persistence";

const manifest: BenchmarkManifest = {
  name: "private-suite",
  version: 3,
  cases: [
    {
      id: "case-001",
      imagePath: "private/case-001.jpg",
      expectedItems: [
        {
          category: "top",
          colors: ["black"],
          pattern: null,
          material: null,
          styles: [],
          visibleBrand: null,
        },
      ],
    },
  ],
};

const run: BenchmarkRunResult = {
  manifestName: manifest.name,
  manifestVersion: manifest.version,
  startedAt: "2026-07-11T20:00:00.000Z",
  completedAt: "2026-07-11T20:00:01.000Z",
  totalCases: 1,
  scoredCases: 1,
  failedCases: 0,
  averageOverallScore: 1,
  averageResponseTimeMs: 20,
  caseResults: [
    {
      caseId: "case-001",
      imagePath: "private/case-001.jpg",
      status: "scored",
      responseTimeMs: 20,
      errorMessage: null,
      fieldScores: {
        category: 1,
        colors: 1,
        pattern: 1,
        material: 1,
        styles: 1,
        visibleBrand: 1,
        brandHallucination: 1,
      },
      overallScore: 1,
    },
  ],
};

function mockPersistence(existing: PersistedRunState | null = null) {
  const calls: string[] = [];
  const persistence: BenchmarkPersistence = {
    ensureCases: async () => {
      calls.push("ensureCases");
    },
    getRunStatus: async () => {
      calls.push("getRunStatus");
      return existing;
    },
    startRun: async () => {
      calls.push("startRun");
    },
    recordResult: async () => {
      calls.push("recordResult");
    },
    completeRun: async () => {
      calls.push("completeRun");
    },
  };
  return { calls, persistence };
}

describe("benchmark persistence integration", () => {
  test("stable inputs produce a stable idempotency key and deterministic UUID", () => {
    const first = createBenchmarkIdempotency(manifest, { provider: "mock", model: "fixture-v1" });
    const second = createBenchmarkIdempotency(manifest, { provider: "mock", model: "fixture-v1" });
    expect(first).toEqual(second);
    expect(first.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    expect(first.runId).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
  });

  test("dry-run performs exactly zero persistence calls", async () => {
    const mock = mockPersistence();
    const outcome = await persistBenchmarkRun(
      manifest,
      { provider: "mock", model: "fixture-v1" },
      run,
      mock.persistence,
      { dryRun: true },
    );
    expect(outcome.writesPerformed).toBe(0);
    expect(mock.calls).toEqual([]);
  });

  test("new runs persist cases, metadata, results, timing, scores, and completion", async () => {
    const mock = mockPersistence();
    const outcome = await persistBenchmarkRun(
      manifest,
      { provider: "mock", model: "fixture-v1" },
      run,
      mock.persistence,
      { dryRun: false },
    );
    expect(outcome.alreadyCompleted).toBe(false);
    expect(mock.calls).toEqual([
      "ensureCases",
      "getRunStatus",
      "startRun",
      "recordResult",
      "completeRun",
    ]);
  });

  test("completed duplicate submissions never rewrite results", async () => {
    const mock = mockPersistence("completed");
    const outcome = await persistBenchmarkRun(
      manifest,
      { provider: "mock", model: "fixture-v1" },
      run,
      mock.persistence,
      { dryRun: false },
    );
    expect(outcome.alreadyCompleted).toBe(true);
    expect(mock.calls).toEqual(["ensureCases", "getRunStatus"]);
  });
});
