import { createHash } from "node:crypto";
import { z } from "zod";

// Strongly typed structures for Veylor's PRIVATE visual item-memory
// feasibility benchmark (Stage 2A).
//
// This benchmark answers one question offline: can an embedding model
// recognize the same fashion item across different photos, angles, crops,
// lighting, backgrounds, and users? It is benchmark-only scaffolding:
// no pgvector, no production embedding tables, no scan-flow changes, and no
// public exposure. Benchmark images live OUTSIDE the repository (for example
// in the untracked benchmarks/visual-item-memory/private-images/ directory)
// and are referenced by path only. Cases may also be metadata-only, carrying
// a deterministic mock signature instead of an image so the harness can be
// exercised without any real photos.

/** The relationship the benchmark expects between a query and a candidate. */
export const EXPECTED_RELATIONSHIPS = [
  "same_item",
  "visually_similar_but_different",
  "different_item",
] as const;
export type ExpectedRelationship = (typeof EXPECTED_RELATIONSHIPS)[number];

/** The controlled condition a case exercises (Stage 2A scenarios 1-10). */
export const CASE_CONDITIONS = [
  "different_photo",
  "different_angle",
  "different_crop",
  "different_lighting_background",
  "different_colorway",
  "lookalike_product",
  "same_brand_different_model",
  "unrelated",
  "partial_occlusion",
  "low_resolution",
] as const;
export type CaseCondition = (typeof CASE_CONDITIONS)[number];

/** Privacy classification for a case's assets. */
export const PRIVACY_CLASSES = ["synthetic", "approved_private", "metadata_only"] as const;
export type PrivacyClass = (typeof PRIVACY_CLASSES)[number];

const STABLE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;

/**
 * A reference to one benchmark image. Exactly like the fashion-scan
 * benchmark, real image bytes never enter the repository or the database.
 * Either a private filesystem path or a deterministic mock signature (used by
 * the mock embedding provider) must be present; metadata-only cases carry a
 * signature and no path.
 */
export const ImageRefSchema = z
  .object({
    /** Private, untracked path. Never a URL, never a public asset. */
    path: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine((value) => !/(^|[\\/])\.\.([\\/]|$)/.test(value), {
        message: "Image paths must not contain traversal segments.",
      })
      .refine((value) => !/^[a-z][a-z0-9+.-]*:\/\//i.test(value), {
        message: "Image paths must be local paths, not URLs.",
      })
      .nullable()
      .default(null),
    /**
     * Deterministic latent signature consumed by the mock provider. Values
     * are dimensionless authored numbers, not real embeddings.
     */
    mockSignature: z.array(z.number().finite()).min(2).max(256).nullable().default(null),
    /** True when the image is a generated/synthetic perturbation. */
    synthetic: z.boolean().default(false),
    note: z.string().trim().min(1).max(300).optional(),
  })
  .strict()
  .refine((image) => image.path !== null || image.mockSignature !== null, {
    message: "An image needs a private path, a mock signature, or both.",
  });
export type ImageRef = z.infer<typeof ImageRefSchema>;

export const CandidateSchema = z
  .object({
    id: z.string().trim().regex(STABLE_ID_PATTERN, "Candidate ids must be stable slugs."),
    image: ImageRefSchema,
    expectedRelationship: z.enum(EXPECTED_RELATIONSHIPS),
    /** Brand of the candidate item, when known. */
    brand: z.string().trim().min(1).max(120).nullable().default(null),
    /** Product/model identifier of the candidate item, when known. */
    productId: z.string().trim().min(1).max(200).nullable().default(null),
    notes: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type VisualBenchmarkCandidate = z.infer<typeof CandidateSchema>;

export const VisualBenchmarkCaseSchema = z
  .object({
    /** Stable case id (same slug rules as the Stage 31 case registry). */
    id: z.string().trim().regex(STABLE_ID_PATTERN, "Case ids must be stable slugs."),
    condition: z.enum(CASE_CONDITIONS),
    category: z.string().trim().min(1).max(120),
    /** Brand of the query item, when known. */
    brand: z.string().trim().min(1).max(120).nullable().default(null),
    /** Product/model identifier of the query item, when known. */
    productId: z.string().trim().min(1).max(200).nullable().default(null),
    notes: z.string().trim().min(1).max(500).optional(),
    /** Where the case assets came from (provenance, required). */
    source: z.string().trim().min(1).max(300),
    privacy: z.enum(PRIVACY_CLASSES),
    queryImage: ImageRefSchema,
    candidates: z.array(CandidateSchema).min(1).max(20),
  })
  .strict()
  .superRefine((benchmarkCase, context) => {
    const seen = new Set<string>();
    for (const candidate of benchmarkCase.candidates) {
      if (seen.has(candidate.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate candidate id: ${candidate.id}`,
          path: ["candidates"],
        });
      }
      seen.add(candidate.id);
    }
    if (benchmarkCase.privacy === "metadata_only") {
      const images = [benchmarkCase.queryImage, ...benchmarkCase.candidates.map((c) => c.image)];
      if (images.some((image) => image.path !== null)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "metadata_only cases must not reference image paths.",
          path: ["privacy"],
        });
      }
    }
  });
export type VisualBenchmarkCase = z.infer<typeof VisualBenchmarkCaseSchema>;

export const VisualBenchmarkManifestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    version: z.number().int().positive(),
    description: z.string().trim().min(1).max(1000).optional(),
    cases: z.array(VisualBenchmarkCaseSchema).min(1).max(200),
  })
  .strict()
  .superRefine((manifest, context) => {
    const seen = new Set<string>();
    for (const benchmarkCase of manifest.cases) {
      if (seen.has(benchmarkCase.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate case id: ${benchmarkCase.id}`,
          path: ["cases"],
        });
      }
      seen.add(benchmarkCase.id);
    }
  });
export type VisualBenchmarkManifest = z.infer<typeof VisualBenchmarkManifestSchema>;

/** Provider/model metadata recorded with every run. */
export type VisualProviderMetadata = {
  provider: string;
  model: string;
  modelVersion: string;
  embeddingDimension: number;
};

/** Runner configuration recorded with every run (no production threshold). */
export type VisualBenchmarkConfig = {
  topK: number;
  /** Thresholds swept for the recall/false-positive tradeoff report. */
  thresholds: number[];
  batchSize: number;
};

function stableImageKey(image: ImageRef): string {
  return JSON.stringify({
    path: image.path,
    mockSignature: image.mockSignature,
    synthetic: image.synthetic,
  });
}

/**
 * Stable per-case idempotency key: identical case content always produces the
 * same key, so duplicate case submissions are detectable regardless of run.
 */
export function caseIdempotencyKey(benchmarkCase: VisualBenchmarkCase): string {
  const material = JSON.stringify({
    id: benchmarkCase.id,
    condition: benchmarkCase.condition,
    category: benchmarkCase.category,
    brand: benchmarkCase.brand,
    productId: benchmarkCase.productId,
    query: stableImageKey(benchmarkCase.queryImage),
    candidates: benchmarkCase.candidates
      .map((candidate) =>
        JSON.stringify({
          id: candidate.id,
          image: stableImageKey(candidate.image),
          expectedRelationship: candidate.expectedRelationship,
        }),
      )
      .sort(),
  });
  return createHash("sha256").update(material).digest("hex");
}

/** Parses and validates manifest JSON text. Throws descriptive errors. */
export function parseVisualManifest(jsonText: string): VisualBenchmarkManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    throw new Error("Visual benchmark manifest is not valid JSON.");
  }
  const parsed = VisualBenchmarkManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? issue.path.join(".") : "(root)";
    throw new Error(
      `Visual benchmark manifest failed validation: ${where} — ${issue?.message ?? "unknown issue"}`,
    );
  }
  return parsed.data;
}
