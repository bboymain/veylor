import type {
  CaseCondition,
  ExpectedRelationship,
  VisualBenchmarkCase,
  VisualBenchmarkManifest,
} from "./schema";

// Pure, deterministic evaluation for the PRIVATE visual item-memory
// benchmark: cosine similarity, ranking metrics, confusion counts, and
// threshold sweeps. No I/O, no network, no provider knowledge.
//
// Deliberately, no production threshold is defined anywhere in this module.
// Callers must pass the thresholds they want swept; the output reports the
// recall/false-positive tradeoff so a threshold can be chosen later, with
// evidence, in a separate approved stage.

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimensions differ (${a.length} vs ${b.length}).`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export type CandidateSimilarity = {
  candidateId: string;
  expectedRelationship: ExpectedRelationship;
  /** Null when the candidate's embedding failed. */
  similarity: number | null;
};

export type CaseEvaluationStatus = "evaluated" | "query_failed" | "all_candidates_failed";

export type CaseEvaluation = {
  caseId: string;
  condition: CaseCondition;
  category: string;
  status: CaseEvaluationStatus;
  /** Sorted by similarity, highest first; failed candidates sort last. */
  candidateSimilarities: CandidateSimilarity[];
  /** True when the top-ranked candidate is a same_item candidate. */
  top1IsSameItem: boolean | null;
  failures: string[];
};

export type ConfusionCounts = {
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
};

export type ThresholdSweepEntry = {
  threshold: number;
  confusion: ConfusionCounts;
  /** FP / (FP + TN); null when no negative pairs exist. */
  falsePositiveRate: number | null;
  /** FN / (FN + TP); null when no same_item pairs exist. */
  falseNegativeRate: number | null;
  /** TP / (TP + FN); null when no same_item pairs exist. */
  sameItemRecall: number | null;
  /** TP / (TP + FP); null when nothing was predicted positive. */
  precision: number | null;
  /** How many predicted-positive pairs came from each relationship. */
  predictedPositiveByRelationship: Record<ExpectedRelationship, number>;
};

export type GroupMetrics = {
  cases: number;
  evaluatedCases: number;
  top1Accuracy: number | null;
  meanSameItemSimilarity: number | null;
  meanSimilarButDifferentSimilarity: number | null;
  meanDifferentItemSimilarity: number | null;
  /** meanSameItemSimilarity minus the best non-same mean; null when unknown. */
  separationMargin: number | null;
};

export type LatencyStats = {
  images: number;
  meanMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
};

export type VisualBenchmarkMetrics = {
  totalCases: number;
  evaluatedCases: number;
  failedCases: number;
  /** Over evaluated cases containing >= 1 same_item candidate. */
  top1Accuracy: number | null;
  /** Case-level: a same_item candidate appears in the top-k ranking. */
  sameItemRecallAtK: number | null;
  topK: number;
  thresholdSweep: ThresholdSweepEntry[];
  perCategory: Record<string, GroupMetrics>;
  perCondition: Record<string, GroupMetrics>;
};

type EmbeddingLookup = (imageId: string) => number[] | null;

export function evaluateCase(
  benchmarkCase: VisualBenchmarkCase,
  lookupEmbedding: EmbeddingLookup,
  imageError: (imageId: string) => string | null,
): CaseEvaluation {
  const queryId = `${benchmarkCase.id}/query`;
  const failures: string[] = [];
  const queryEmbedding = lookupEmbedding(queryId);

  if (queryEmbedding === null) {
    failures.push(`query embedding failed: ${imageError(queryId) ?? "no embedding produced"}`);
    return {
      caseId: benchmarkCase.id,
      condition: benchmarkCase.condition,
      category: benchmarkCase.category,
      status: "query_failed",
      candidateSimilarities: benchmarkCase.candidates.map((candidate) => ({
        candidateId: candidate.id,
        expectedRelationship: candidate.expectedRelationship,
        similarity: null,
      })),
      top1IsSameItem: null,
      failures,
    };
  }

  const similarities: CandidateSimilarity[] = benchmarkCase.candidates.map((candidate) => {
    const candidateImageId = `${benchmarkCase.id}/${candidate.id}`;
    const embedding = lookupEmbedding(candidateImageId);
    if (embedding === null) {
      failures.push(
        `candidate ${candidate.id} embedding failed: ` +
          `${imageError(candidateImageId) ?? "no embedding produced"}`,
      );
      return {
        candidateId: candidate.id,
        expectedRelationship: candidate.expectedRelationship,
        similarity: null,
      };
    }
    return {
      candidateId: candidate.id,
      expectedRelationship: candidate.expectedRelationship,
      similarity: cosineSimilarity(queryEmbedding, embedding),
    };
  });

  const ranked = [...similarities].sort((left, right) => {
    if (left.similarity === null && right.similarity === null) return 0;
    if (left.similarity === null) return 1;
    if (right.similarity === null) return -1;
    if (right.similarity !== left.similarity) return right.similarity - left.similarity;
    // Deterministic tie-break so equal similarities keep a stable order.
    return left.candidateId < right.candidateId ? -1 : left.candidateId > right.candidateId ? 1 : 0;
  });

  const usable = ranked.filter((entry) => entry.similarity !== null);
  if (usable.length === 0) {
    return {
      caseId: benchmarkCase.id,
      condition: benchmarkCase.condition,
      category: benchmarkCase.category,
      status: "all_candidates_failed",
      candidateSimilarities: ranked,
      top1IsSameItem: null,
      failures,
    };
  }

  const hasSameItem = benchmarkCase.candidates.some(
    (candidate) => candidate.expectedRelationship === "same_item",
  );
  const top1IsSameItem = hasSameItem ? usable[0].expectedRelationship === "same_item" : null;

  return {
    caseId: benchmarkCase.id,
    condition: benchmarkCase.condition,
    category: benchmarkCase.category,
    status: "evaluated",
    candidateSimilarities: ranked,
    top1IsSameItem,
    failures,
  };
}

function emptyRelationshipCounts(): Record<ExpectedRelationship, number> {
  return { same_item: 0, visually_similar_but_different: 0, different_item: 0 };
}

type Pair = { relationship: ExpectedRelationship; similarity: number };

function collectPairs(evaluations: readonly CaseEvaluation[]): Pair[] {
  const pairs: Pair[] = [];
  for (const evaluation of evaluations) {
    if (evaluation.status !== "evaluated") continue;
    for (const entry of evaluation.candidateSimilarities) {
      if (entry.similarity === null) continue;
      pairs.push({ relationship: entry.expectedRelationship, similarity: entry.similarity });
    }
  }
  return pairs;
}

export function computeThresholdSweep(
  evaluations: readonly CaseEvaluation[],
  thresholds: readonly number[],
): ThresholdSweepEntry[] {
  const pairs = collectPairs(evaluations);
  return [...thresholds]
    .sort((a, b) => a - b)
    .map((threshold) => {
      const confusion: ConfusionCounts = {
        truePositives: 0,
        falsePositives: 0,
        trueNegatives: 0,
        falseNegatives: 0,
      };
      const predictedPositiveByRelationship = emptyRelationshipCounts();
      for (const pair of pairs) {
        const predictedSame = pair.similarity >= threshold;
        if (predictedSame) predictedPositiveByRelationship[pair.relationship] += 1;
        if (pair.relationship === "same_item") {
          if (predictedSame) confusion.truePositives += 1;
          else confusion.falseNegatives += 1;
        } else {
          if (predictedSame) confusion.falsePositives += 1;
          else confusion.trueNegatives += 1;
        }
      }
      const positives = confusion.truePositives + confusion.falseNegatives;
      const negatives = confusion.falsePositives + confusion.trueNegatives;
      const predicted = confusion.truePositives + confusion.falsePositives;
      return {
        threshold,
        confusion,
        falsePositiveRate: negatives > 0 ? confusion.falsePositives / negatives : null,
        falseNegativeRate: positives > 0 ? confusion.falseNegatives / positives : null,
        sameItemRecall: positives > 0 ? confusion.truePositives / positives : null,
        precision: predicted > 0 ? confusion.truePositives / predicted : null,
        predictedPositiveByRelationship,
      };
    });
}

function meanOrNull(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function groupMetrics(evaluations: readonly CaseEvaluation[]): GroupMetrics {
  const evaluated = evaluations.filter((evaluation) => evaluation.status === "evaluated");
  const top1Considered = evaluated.filter((evaluation) => evaluation.top1IsSameItem !== null);
  const byRelationship: Record<ExpectedRelationship, number[]> = {
    same_item: [],
    visually_similar_but_different: [],
    different_item: [],
  };
  for (const evaluation of evaluated) {
    for (const entry of evaluation.candidateSimilarities) {
      if (entry.similarity === null) continue;
      byRelationship[entry.expectedRelationship].push(entry.similarity);
    }
  }
  const meanSame = meanOrNull(byRelationship.same_item);
  const meanSimilar = meanOrNull(byRelationship.visually_similar_but_different);
  const meanDifferent = meanOrNull(byRelationship.different_item);
  const nonSameMeans = [meanSimilar, meanDifferent].filter(
    (value): value is number => value !== null,
  );
  return {
    cases: evaluations.length,
    evaluatedCases: evaluated.length,
    top1Accuracy:
      top1Considered.length > 0
        ? top1Considered.filter((evaluation) => evaluation.top1IsSameItem === true).length /
          top1Considered.length
        : null,
    meanSameItemSimilarity: meanSame,
    meanSimilarButDifferentSimilarity: meanSimilar,
    meanDifferentItemSimilarity: meanDifferent,
    separationMargin:
      meanSame !== null && nonSameMeans.length > 0 ? meanSame - Math.max(...nonSameMeans) : null,
  };
}

function groupBy<Key extends string>(
  evaluations: readonly CaseEvaluation[],
  key: (evaluation: CaseEvaluation) => Key,
): Record<string, GroupMetrics> {
  const groups = new Map<string, CaseEvaluation[]>();
  for (const evaluation of evaluations) {
    const groupKey = key(evaluation);
    const bucket = groups.get(groupKey);
    if (bucket) bucket.push(evaluation);
    else groups.set(groupKey, [evaluation]);
  }
  const result: Record<string, GroupMetrics> = {};
  for (const [groupKey, groupEvaluations] of [...groups.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    result[groupKey] = groupMetrics(groupEvaluations);
  }
  return result;
}

export function computeLatencyStats(latenciesMs: readonly number[]): LatencyStats {
  if (latenciesMs.length === 0) {
    return { images: 0, meanMs: null, p50Ms: null, p95Ms: null, maxMs: null };
  }
  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const percentile = (fraction: number): number => {
    const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
    return sorted[Math.max(0, index)];
  };
  return {
    images: sorted.length,
    meanMs: meanOrNull(sorted),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted[sorted.length - 1],
  };
}

export function computeMetrics(
  manifest: VisualBenchmarkManifest,
  evaluations: readonly CaseEvaluation[],
  config: { topK: number; thresholds: readonly number[] },
): VisualBenchmarkMetrics {
  if (!Number.isInteger(config.topK) || config.topK < 1) {
    throw new Error("topK must be a positive integer.");
  }
  const evaluated = evaluations.filter((evaluation) => evaluation.status === "evaluated");

  const top1Considered = evaluated.filter((evaluation) => evaluation.top1IsSameItem !== null);
  const top1Accuracy =
    top1Considered.length > 0
      ? top1Considered.filter((evaluation) => evaluation.top1IsSameItem === true).length /
        top1Considered.length
      : null;

  const caseById = new Map(
    manifest.cases.map((benchmarkCase) => [benchmarkCase.id, benchmarkCase]),
  );
  const recallConsidered = evaluated.filter((evaluation) => {
    const benchmarkCase = caseById.get(evaluation.caseId);
    return (
      benchmarkCase !== undefined &&
      benchmarkCase.candidates.some((candidate) => candidate.expectedRelationship === "same_item")
    );
  });
  const recallHits = recallConsidered.filter((evaluation) => {
    const topEntries = evaluation.candidateSimilarities
      .filter((entry) => entry.similarity !== null)
      .slice(0, config.topK);
    return topEntries.some((entry) => entry.expectedRelationship === "same_item");
  });

  return {
    totalCases: evaluations.length,
    evaluatedCases: evaluated.length,
    failedCases: evaluations.length - evaluated.length,
    top1Accuracy,
    sameItemRecallAtK:
      recallConsidered.length > 0 ? recallHits.length / recallConsidered.length : null,
    topK: config.topK,
    thresholdSweep: computeThresholdSweep(evaluations, config.thresholds),
    perCategory: groupBy(evaluations, (evaluation) => evaluation.category),
    perCondition: groupBy(evaluations, (evaluation) => evaluation.condition),
  };
}

/** Builds an inclusive threshold list from a start:end:step range spec. */
export function buildThresholdRange(start: number, end: number, step: number): number[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(step) || step <= 0) {
    throw new Error("Threshold range requires finite start/end and a positive step.");
  }
  if (end < start) throw new Error("Threshold range end must be >= start.");
  const thresholds: number[] = [];
  // Round to 6 decimals to avoid floating-point drift in the sweep labels.
  for (let value = start; value <= end + 1e-9; value += step) {
    thresholds.push(Math.round(value * 1e6) / 1e6);
  }
  return thresholds;
}
