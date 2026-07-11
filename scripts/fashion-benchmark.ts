import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { z } from "zod";
import {
  analyzeFashionWithGemini,
  GEMINI_MODEL,
  type GeminiProviderConfig,
} from "../src/lib/gemini-fashion";
import type { FashionScanResult } from "../src/lib/fashion-scan";
import {
  parseDataUrlImage,
  type ParsedDataUrlImage,
  type SupportedImageMimeType,
} from "../src/lib/image-data";
import {
  scoreBenchmarkItems,
  type BenchmarkScores,
  type ScoreCounts,
} from "./fashion-benchmark-scoring";

const ExpectedItemSchema = z
  .object({
    category: z.string().trim().min(1),
    color: z.string().trim().min(1),
    style: z.string().trim().min(1),
    pattern: z.string().trim().min(1).nullable(),
    material: z.string().trim().min(1).nullable(),
    visibleBrand: z.string().trim().min(1).nullable(),
  })
  .strict();

const BenchmarkCaseSchema = z
  .object({
    id: z.string().trim().min(1),
    image: z.string().trim().min(1),
    expectedItems: z.array(ExpectedItemSchema).min(1),
  })
  .strict();

export const BenchmarkManifestSchema = z
  .object({
    version: z.literal(1),
    cases: z.array(BenchmarkCaseSchema).min(1).max(30),
  })
  .strict()
  .superRefine((manifest, context) => {
    const seen = new Set<string>();
    for (const benchmarkCase of manifest.cases) {
      if (seen.has(benchmarkCase.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate benchmark id: ${benchmarkCase.id}`,
          path: ["cases"],
        });
      }
      seen.add(benchmarkCase.id);
    }
  });

export type BenchmarkManifest = z.infer<typeof BenchmarkManifestSchema>;
export type BenchmarkExpectedItem = z.infer<typeof ExpectedItemSchema>;

type BenchmarkAnalyzer = (image: ParsedDataUrlImage) => Promise<FashionScanResult>;

type BenchmarkSuccess = {
  id: string;
  image: string;
  expectedItems: BenchmarkExpectedItem[];
  responseTimeMs: number;
  status: "success";
  returned: FashionScanResult;
  scores: BenchmarkScores;
};

type BenchmarkFailure = {
  id: string;
  image: string;
  expectedItems: BenchmarkExpectedItem[];
  responseTimeMs: number;
  status: "failure";
  error: {
    name: string;
    message: string;
  };
};

export type BenchmarkCaseResult = BenchmarkSuccess | BenchmarkFailure;

export type BenchmarkRun = {
  version: 1;
  model: string;
  manifestPath: string;
  startedAt: string;
  completedAt: string;
  totals: {
    cases: number;
    succeeded: number;
    failed: number;
    successRate: number;
    averageResponseTimeMs: number;
    exact: number;
    close: number;
    wrong: number;
    unknown: number;
    brandHallucinations: number;
  };
  cases: BenchmarkCaseResult[];
};

const IMAGE_MIME_TYPES: Record<string, SupportedImageMimeType> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "Error", message: String(error) };
}

async function readManifest(manifestPath: string) {
  const contents = await readFile(manifestPath, "utf8");
  return BenchmarkManifestSchema.parse(JSON.parse(contents));
}

async function readBenchmarkImage(imagePath: string) {
  const mimeType = IMAGE_MIME_TYPES[extname(imagePath).toLowerCase()];
  if (!mimeType) {
    throw new Error(`Unsupported benchmark image type: ${extname(imagePath) || "none"}`);
  }

  const bytes = await readFile(imagePath);
  return parseDataUrlImage(`data:${mimeType};base64,${bytes.toString("base64")}`);
}

export async function runFashionBenchmark(options: {
  manifestPath: string;
  analyze: BenchmarkAnalyzer;
  model?: string;
}): Promise<BenchmarkRun> {
  const manifestPath = resolve(options.manifestPath);
  const manifest = await readManifest(manifestPath);
  const manifestDirectory = dirname(manifestPath);
  const startedAt = new Date().toISOString();
  const cases: BenchmarkCaseResult[] = [];

  for (const benchmarkCase of manifest.cases) {
    const start = performance.now();
    try {
      const image = await readBenchmarkImage(resolve(manifestDirectory, benchmarkCase.image));
      const returned = await options.analyze(image);
      cases.push({
        ...benchmarkCase,
        responseTimeMs: Math.round(performance.now() - start),
        status: "success",
        returned,
        scores: scoreBenchmarkItems(benchmarkCase.expectedItems, returned.items),
      });
    } catch (error) {
      cases.push({
        ...benchmarkCase,
        responseTimeMs: Math.round(performance.now() - start),
        status: "failure",
        error: serializeError(error),
      });
    }
  }

  const succeeded = cases.filter((result) => result.status === "success").length;
  const scoreTotals = cases.reduce<ScoreCounts>(
    (totals, result) => {
      if (result.status !== "success") return totals;
      totals.exact += result.scores.totals.exact;
      totals.close += result.scores.totals.close;
      totals.wrong += result.scores.totals.wrong;
      totals.unknown += result.scores.totals.unknown;
      totals.brandHallucinations += result.scores.totals.brandHallucinations;
      return totals;
    },
    { exact: 0, close: 0, wrong: 0, unknown: 0, brandHallucinations: 0 },
  );
  const averageResponseTimeMs = Math.round(
    cases.reduce((total, result) => total + result.responseTimeMs, 0) / cases.length,
  );
  return {
    version: 1,
    model: options.model ?? GEMINI_MODEL,
    manifestPath,
    startedAt,
    completedAt: new Date().toISOString(),
    totals: {
      cases: cases.length,
      succeeded,
      failed: cases.length - succeeded,
      successRate: succeeded / cases.length,
      averageResponseTimeMs,
      ...scoreTotals,
    },
    cases,
  };
}

export async function saveBenchmarkRun(run: BenchmarkRun, outputPath: string) {
  const resolvedOutputPath = resolve(outputPath);
  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  return resolvedOutputPath;
}

function defaultOutputPath() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return resolve("benchmark", "results", `gemini-${timestamp}.json`);
}

async function main() {
  const manifestPath = process.argv[2] ?? resolve("benchmark", "manifest.local.json");
  const outputPath = process.argv[3] ?? defaultOutputPath();
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required. Add it to your untracked .env.local file.");
  }

  const config: GeminiProviderConfig = { apiKey };
  const run = await runFashionBenchmark({
    manifestPath,
    analyze: (image) => analyzeFashionWithGemini(image, config),
  });
  const savedPath = await saveBenchmarkRun(run, outputPath);

  console.log(`Saved ${run.totals.cases} benchmark cases to ${savedPath}`);
  console.log(
    `Success: ${(run.totals.successRate * 100).toFixed(1)}%; average: ${run.totals.averageResponseTimeMs} ms`,
  );
  console.log(
    `Fields: ${run.totals.exact} exact, ${run.totals.close} close, ${run.totals.wrong} wrong, ${run.totals.unknown} unknown; brand hallucinations: ${run.totals.brandHallucinations}`,
  );
  if (run.totals.failed > 0) process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(serializeError(error).message);
    process.exitCode = 1;
  });
}
