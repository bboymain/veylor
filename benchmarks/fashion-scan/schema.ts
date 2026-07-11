import { z } from "zod";

// Strongly typed structures for Veylor's private fashion-image benchmark
// runner. Benchmark images live OUTSIDE the repository (for example in a
// local private-benchmarks/ directory) and are referenced by path only —
// no images, model calls, or network access belong in this module.

export const ExpectedFashionItemSchema = z.object({
  category: z.string().trim().min(1),
  colors: z.array(z.string().trim().min(1)).default([]),
  pattern: z.string().trim().min(1).nullable().default(null),
  material: z.string().trim().min(1).nullable().default(null),
  styles: z.array(z.string().trim().min(1)).default([]),
  visibleBrand: z.string().trim().min(1).nullable().default(null),
});
export type ExpectedFashionItem = z.infer<typeof ExpectedFashionItemSchema>;

export const BenchmarkCaseSchema = z.object({
  id: z.string().trim().min(1),
  /** Path to a private, untracked image. Never commit real benchmark images. */
  imagePath: z.string().trim().min(1),
  description: z.string().optional(),
  expectedItems: z.array(ExpectedFashionItemSchema).min(1),
});
export type BenchmarkCase = z.infer<typeof BenchmarkCaseSchema>;

export const BenchmarkManifestSchema = z.object({
  name: z.string().trim().min(1),
  version: z.number().int().positive(),
  description: z.string().optional(),
  cases: z.array(BenchmarkCaseSchema).min(1),
});
export type BenchmarkManifest = z.infer<typeof BenchmarkManifestSchema>;

/**
 * A provider's detection for one item after normalization. The shape mirrors
 * ExpectedFashionItem, but every field may be absent because providers can
 * fail to detect anything.
 */
export type NormalizedDetectedItem = {
  category: string | null;
  colors: string[];
  pattern: string | null;
  material: string | null;
  styles: string[];
  visibleBrand: string | null;
};

export type PerFieldScores = {
  category: number;
  colors: number;
  pattern: number;
  material: number;
  styles: number;
  visibleBrand: number;
  /** 1 = no hallucinated brand; 0 = the provider reported a wrong/invented brand. */
  brandHallucination: number;
};

export type CaseStatus = "scored" | "provider_error" | "invalid_output";

export type CaseBenchmarkResult = {
  caseId: string;
  imagePath: string;
  status: CaseStatus;
  responseTimeMs: number;
  /** Sanitized failure summary; never raw provider payloads or secrets. */
  errorMessage: string | null;
  fieldScores: PerFieldScores | null;
  overallScore: number | null;
};

export type BenchmarkRunResult = {
  manifestName: string;
  manifestVersion: number;
  startedAt: string;
  completedAt: string;
  totalCases: number;
  scoredCases: number;
  failedCases: number;
  averageOverallScore: number | null;
  averageResponseTimeMs: number | null;
  caseResults: CaseBenchmarkResult[];
};
