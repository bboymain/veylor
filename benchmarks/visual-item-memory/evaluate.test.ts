import { describe, expect, test } from "bun:test";
import {
  buildThresholdRange,
  computeLatencyStats,
  computeMetrics,
  computeThresholdSweep,
  cosineSimilarity,
  evaluateCase,
  type CaseEvaluation,
} from "./evaluate";
import { VisualBenchmarkCaseSchema, VisualBenchmarkManifestSchema } from "./schema";

function makeCase(
  id: string,
  candidates: Array<{ id: string; relationship: string }>,
  condition = "different_photo",
  category = "jacket",
) {
  return VisualBenchmarkCaseSchema.parse({
    id,
    condition,
    category,
    source: "unit-test fixture",
    privacy: "metadata_only",
    queryImage: { mockSignature: [1, 0] },
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      image: { mockSignature: [1, 0] },
      expectedRelationship: candidate.relationship,
    })),
  });
}

function evaluationWith(
  caseId: string,
  entries: Array<{ id: string; relationship: string; similarity: number | null }>,
  overrides: Partial<CaseEvaluation> = {},
): CaseEvaluation {
  return {
    caseId,
    condition: "different_photo",
    category: "jacket",
    status: "evaluated",
    candidateSimilarities: entries.map((entry) => ({
      candidateId: entry.id,
      expectedRelationship:
        entry.relationship as CaseEvaluation["candidateSimilarities"][number]["expectedRelationship"],
      similarity: entry.similarity,
    })),
    top1IsSameItem: null,
    failures: [],
    ...overrides,
  };
}

describe("cosine similarity", () => {
  test("matches hand-computed values", () => {
    expect(cosineSimilarity([1, 0], [0.6, 0.8])).toBeCloseTo(0.6, 10);
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 10);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
    expect(cosineSimilarity([2, 0], [4, 0])).toBeCloseTo(1, 10);
  });

  test("rejects mismatched dimensions and handles zero vectors", () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow("dimensions differ");
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });
});

describe("case evaluation and ranking", () => {
  test("ranks candidates by similarity with a deterministic tie-break", () => {
    const benchmarkCase = makeCase("rank-case", [
      { id: "low", relationship: "different_item" },
      { id: "high", relationship: "same_item" },
      { id: "tie-b", relationship: "different_item" },
      { id: "tie-a", relationship: "different_item" },
    ]);
    const embeddings: Record<string, number[]> = {
      "rank-case/query": [1, 0],
      "rank-case/low": [0, 1],
      "rank-case/high": [1, 0.01],
      "rank-case/tie-b": [0.5, 0.5],
      "rank-case/tie-a": [0.5, 0.5],
    };
    const evaluation = evaluateCase(
      benchmarkCase,
      (imageId) => embeddings[imageId] ?? null,
      () => null,
    );
    expect(evaluation.status).toBe("evaluated");
    expect(evaluation.candidateSimilarities.map((entry) => entry.candidateId)).toEqual([
      "high",
      "tie-a",
      "tie-b",
      "low",
    ]);
    expect(evaluation.top1IsSameItem).toBe(true);
  });

  test("marks query failures and candidate failures separately", () => {
    const benchmarkCase = makeCase("fail-case", [{ id: "cand-a", relationship: "same_item" }]);
    const queryFailed = evaluateCase(
      benchmarkCase,
      () => null,
      () => "boom",
    );
    expect(queryFailed.status).toBe("query_failed");
    expect(queryFailed.top1IsSameItem).toBeNull();
    expect(queryFailed.failures[0]).toContain("query embedding failed");

    const candidatesFailed = evaluateCase(
      benchmarkCase,
      (imageId) => (imageId.endsWith("/query") ? [1, 0] : null),
      () => "cand boom",
    );
    expect(candidatesFailed.status).toBe("all_candidates_failed");
    expect(candidatesFailed.failures[0]).toContain("cand-a embedding failed");
  });
});

describe("threshold sweep and confusion counts", () => {
  const evaluations = [
    evaluationWith("sweep-case", [
      { id: "same-high", relationship: "same_item", similarity: 0.9 },
      { id: "same-low", relationship: "same_item", similarity: 0.6 },
      { id: "similar", relationship: "visually_similar_but_different", similarity: 0.7 },
      { id: "different", relationship: "different_item", similarity: 0.2 },
    ]),
  ];

  test("computes exact confusion counts at each threshold", () => {
    const sweep = computeThresholdSweep(evaluations, [0.5, 0.65, 0.8]);
    expect(sweep.map((entry) => entry.threshold)).toEqual([0.5, 0.65, 0.8]);

    expect(sweep[0].confusion).toEqual({
      truePositives: 2,
      falsePositives: 1,
      trueNegatives: 1,
      falseNegatives: 0,
    });
    expect(sweep[0].sameItemRecall).toBeCloseTo(1, 10);
    expect(sweep[0].falsePositiveRate).toBeCloseTo(0.5, 10);
    expect(sweep[0].falseNegativeRate).toBeCloseTo(0, 10);

    expect(sweep[1].confusion).toEqual({
      truePositives: 1,
      falsePositives: 1,
      trueNegatives: 1,
      falseNegatives: 1,
    });
    expect(sweep[1].precision).toBeCloseTo(0.5, 10);

    expect(sweep[2].confusion).toEqual({
      truePositives: 1,
      falsePositives: 0,
      trueNegatives: 2,
      falseNegatives: 1,
    });
    expect(sweep[2].falsePositiveRate).toBeCloseTo(0, 10);
    expect(sweep[2].sameItemRecall).toBeCloseTo(0.5, 10);
    expect(sweep[2].predictedPositiveByRelationship).toEqual({
      same_item: 1,
      visually_similar_but_different: 0,
      different_item: 0,
    });
  });

  test("skips failed candidates and failed cases in pair counts", () => {
    const withFailures = [
      ...evaluations,
      evaluationWith(
        "failed-case",
        [{ id: "ignored", relationship: "same_item", similarity: null }],
        { status: "query_failed" },
      ),
    ];
    const sweep = computeThresholdSweep(withFailures, [0.5]);
    expect(
      sweep[0].confusion.truePositives +
        sweep[0].confusion.falseNegatives +
        sweep[0].confusion.falsePositives +
        sweep[0].confusion.trueNegatives,
    ).toBe(4);
  });
});

describe("run metrics", () => {
  const manifest = VisualBenchmarkManifestSchema.parse({
    name: "metrics-fixture",
    version: 1,
    cases: [
      makeCase("case-top1", [
        { id: "same-a", relationship: "same_item" },
        { id: "diff-a", relationship: "different_item" },
      ]),
      makeCase("case-rank2", [
        { id: "same-b", relationship: "same_item" },
        { id: "similar-b", relationship: "visually_similar_but_different" },
      ]),
      makeCase("case-no-same", [{ id: "diff-c", relationship: "different_item" }]),
    ],
  });

  const evaluations = [
    evaluationWith(
      "case-top1",
      [
        { id: "same-a", relationship: "same_item", similarity: 0.95 },
        { id: "diff-a", relationship: "different_item", similarity: 0.3 },
      ],
      { top1IsSameItem: true },
    ),
    evaluationWith(
      "case-rank2",
      [
        { id: "similar-b", relationship: "visually_similar_but_different", similarity: 0.9 },
        { id: "same-b", relationship: "same_item", similarity: 0.85 },
      ],
      { top1IsSameItem: false },
    ),
    evaluationWith("case-no-same", [
      { id: "diff-c", relationship: "different_item", similarity: 0.1 },
    ]),
  ];

  test("computes top-1 accuracy over cases that have a same-item candidate", () => {
    const metrics = computeMetrics(manifest, evaluations, { topK: 1, thresholds: [0.8] });
    expect(metrics.top1Accuracy).toBeCloseTo(0.5, 10);
  });

  test("computes same-item recall at k correctly for k=1 and k=2", () => {
    const atOne = computeMetrics(manifest, evaluations, { topK: 1, thresholds: [0.8] });
    expect(atOne.sameItemRecallAtK).toBeCloseTo(0.5, 10);
    const atTwo = computeMetrics(manifest, evaluations, { topK: 2, thresholds: [0.8] });
    expect(atTwo.sameItemRecallAtK).toBeCloseTo(1, 10);
  });

  test("groups per-category and per-condition metrics with separation margins", () => {
    const metrics = computeMetrics(manifest, evaluations, { topK: 1, thresholds: [0.8] });
    expect(Object.keys(metrics.perCategory)).toEqual(["jacket"]);
    const group = metrics.perCategory.jacket;
    expect(group.cases).toBe(3);
    expect(group.meanSameItemSimilarity).toBeCloseTo((0.95 + 0.85) / 2, 10);
    expect(group.meanDifferentItemSimilarity).toBeCloseTo(0.2, 10);
    expect(group.meanSimilarButDifferentSimilarity).toBeCloseTo(0.9, 10);
    expect(group.separationMargin).toBeCloseTo((0.95 + 0.85) / 2 - 0.9, 10);
  });

  test("rejects invalid topK values", () => {
    expect(() => computeMetrics(manifest, evaluations, { topK: 0, thresholds: [0.5] })).toThrow(
      "topK",
    );
  });
});

describe("threshold ranges and latency stats", () => {
  test("builds inclusive ranges without floating point drift", () => {
    expect(buildThresholdRange(0.5, 0.7, 0.05)).toEqual([0.5, 0.55, 0.6, 0.65, 0.7]);
    expect(buildThresholdRange(0.9, 0.9, 0.1)).toEqual([0.9]);
    expect(() => buildThresholdRange(0.9, 0.5, 0.1)).toThrow("end must be >= start");
    expect(() => buildThresholdRange(0.1, 0.9, 0)).toThrow("positive step");
  });

  test("computes latency percentiles", () => {
    const stats = computeLatencyStats([5, 1, 3, 2, 4]);
    expect(stats.images).toBe(5);
    expect(stats.meanMs).toBeCloseTo(3, 10);
    expect(stats.p50Ms).toBe(3);
    expect(stats.p95Ms).toBe(5);
    expect(stats.maxMs).toBe(5);
    expect(computeLatencyStats([]).meanMs).toBeNull();
  });
});
