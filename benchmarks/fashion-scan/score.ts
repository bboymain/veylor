import type { ExpectedFashionItem, NormalizedDetectedItem, PerFieldScores } from "./schema";

// Deterministic scoring utilities for the fashion-scan benchmark.
//
// Every function here is pure: no AI, no network, no randomness, no clock
// reads. Identical inputs always produce identical scores, and every score
// is clamped to the range [0, 1]. Matching normalizes casing and whitespace,
// and null/missing values are handled explicitly.

/** Lowercased, whitespace-collapsed label; empty/blank/missing become null. */
export function normalizeLabel(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
  return normalized || null;
}

/** Normalized, deduplicated, sorted label list; blank entries are dropped. */
export function normalizeLabelList(
  values: readonly (string | null | undefined)[] | null | undefined,
): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeLabel(value);
    if (normalized) seen.add(normalized);
  }
  return [...seen].sort();
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Exact-match score for nullable single labels: both missing → 1 (correctly
 * detected nothing), one missing → 0, otherwise normalized equality.
 */
export function scoreExactLabel(
  expected: string | null | undefined,
  detected: string | null | undefined,
): number {
  const expectedLabel = normalizeLabel(expected);
  const detectedLabel = normalizeLabel(detected);
  if (expectedLabel === null && detectedLabel === null) return 1;
  if (expectedLabel === null || detectedLabel === null) return 0;
  return expectedLabel === detectedLabel ? 1 : 0;
}

/** Category is always expected; a missing or wrong detection scores 0. */
export function scoreCategory(expected: string, detected: string | null | undefined): number {
  const expectedLabel = normalizeLabel(expected);
  if (expectedLabel === null) return 0;
  return normalizeLabel(detected) === expectedLabel ? 1 : 0;
}

/**
 * Jaccard overlap (intersection / union) of normalized label sets.
 * Both empty → 1 (correctly detected nothing); one empty → 0.
 */
export function scoreLabelOverlap(
  expected: readonly (string | null | undefined)[] | null | undefined,
  detected: readonly (string | null | undefined)[] | null | undefined,
): number {
  const expectedLabels = normalizeLabelList(expected);
  const detectedLabels = normalizeLabelList(detected);
  if (expectedLabels.length === 0 && detectedLabels.length === 0) return 1;
  if (expectedLabels.length === 0 || detectedLabels.length === 0) return 0;
  const expectedSet = new Set(expectedLabels);
  const intersection = detectedLabels.filter((label) => expectedSet.has(label)).length;
  const union = new Set([...expectedLabels, ...detectedLabels]).size;
  return clamp01(intersection / union);
}

export function scoreColors(
  expected: readonly string[],
  detected: readonly string[] | null | undefined,
): number {
  return scoreLabelOverlap(expected, detected);
}

export function scoreStyles(
  expected: readonly string[],
  detected: readonly string[] | null | undefined,
): number {
  return scoreLabelOverlap(expected, detected);
}

export function scorePattern(expected: string | null, detected: string | null | undefined): number {
  return scoreExactLabel(expected, detected);
}

export function scoreMaterial(
  expected: string | null,
  detected: string | null | undefined,
): number {
  return scoreExactLabel(expected, detected);
}

export function scoreVisibleBrand(
  expected: string | null,
  detected: string | null | undefined,
): number {
  return scoreExactLabel(expected, detected);
}

/**
 * A brand hallucination is a detected brand that does not match the expected
 * brand — including any detected brand when none was expected. A missing
 * detection is never a hallucination (it may cost accuracy, not honesty).
 */
export function isBrandHallucination(
  expected: string | null,
  detected: string | null | undefined,
): boolean {
  const detectedLabel = normalizeLabel(detected);
  if (detectedLabel === null) return false;
  return detectedLabel !== normalizeLabel(expected);
}

export const DEFAULT_FIELD_WEIGHTS: Readonly<Record<keyof PerFieldScores, number>> = {
  category: 0.25,
  colors: 0.2,
  pattern: 0.1,
  material: 0.1,
  styles: 0.15,
  visibleBrand: 0.1,
  brandHallucination: 0.1,
};

/** Scores every field of one detected item against one expected item. */
export function scoreFields(
  expected: ExpectedFashionItem,
  detected: NormalizedDetectedItem,
): PerFieldScores {
  return {
    category: scoreCategory(expected.category, detected.category),
    colors: scoreColors(expected.colors, detected.colors),
    pattern: scorePattern(expected.pattern, detected.pattern),
    material: scoreMaterial(expected.material, detected.material),
    styles: scoreStyles(expected.styles, detected.styles),
    visibleBrand: scoreVisibleBrand(expected.visibleBrand, detected.visibleBrand),
    brandHallucination: isBrandHallucination(expected.visibleBrand, detected.visibleBrand) ? 0 : 1,
  };
}

/**
 * Weighted average of per-field scores, normalized by the sum of positive
 * weights so the result is always in [0, 1].
 */
export function overallScore(
  fieldScores: PerFieldScores,
  weights: Readonly<Record<keyof PerFieldScores, number>> = DEFAULT_FIELD_WEIGHTS,
): number {
  let total = 0;
  let weightSum = 0;
  for (const key of Object.keys(weights) as (keyof PerFieldScores)[]) {
    const weight = weights[key];
    if (!Number.isFinite(weight) || weight <= 0) continue;
    total += clamp01(fieldScores[key]) * weight;
    weightSum += weight;
  }
  return weightSum > 0 ? clamp01(total / weightSum) : 0;
}
