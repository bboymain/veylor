import { readFileSync } from "node:fs";
import {
  BenchmarkManifestSchema,
  type BenchmarkCase,
  type BenchmarkManifest,
  type BenchmarkRunResult,
  type CaseBenchmarkResult,
  type NormalizedDetectedItem,
  type PerFieldScores,
} from "./schema";
import { overallScore, scoreFields } from "./score";

// Local, sequential benchmark runner scaffold.
//
// This phase wires no live providers: it never calls Gemini, OpenAI,
// Supabase, or any network API. A provider is injected by the caller (tests
// use stubs); the CLI currently supports manifest validation only.

export type BenchmarkProvider = {
  /** Short label recorded in run output, e.g. "stub". */
  name: string;
  /** Produces normalized detections for one case. May throw. */
  detect: (benchmarkCase: BenchmarkCase) => Promise<NormalizedDetectedItem[]>;
};

/** Parses and validates manifest JSON text. Throws descriptive errors. */
export function parseManifest(jsonText: string): BenchmarkManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    throw new Error("Manifest is not valid JSON.");
  }
  const parsed = BenchmarkManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? issue.path.join(".") : "(root)";
    throw new Error(`Manifest failed validation: ${where} — ${issue?.message ?? "unknown issue"}`);
  }
  return parsed.data;
}

/** Reads and validates a manifest file. Throws descriptive errors. */
export function loadManifest(manifestPath: string): BenchmarkManifest {
  let text: string;
  try {
    text = readFileSync(manifestPath, "utf8");
  } catch {
    throw new Error(`Manifest file could not be read: ${manifestPath}`);
  }
  return parseManifest(text);
}

function zeroScores(): PerFieldScores {
  return {
    category: 0,
    colors: 0,
    pattern: 0,
    material: 0,
    styles: 0,
    visibleBrand: 0,
    // Nothing detected is a miss, not a hallucination.
    brandHallucination: 1,
  };
}

function averageFieldScores(perItem: PerFieldScores[]): PerFieldScores {
  const summed = zeroScores();
  summed.brandHallucination = 0;
  for (const scores of perItem) {
    for (const key of Object.keys(summed) as (keyof PerFieldScores)[]) {
      summed[key] += scores[key];
    }
  }
  for (const key of Object.keys(summed) as (keyof PerFieldScores)[]) {
    summed[key] = perItem.length > 0 ? summed[key] / perItem.length : 0;
  }
  return summed;
}

/**
 * Scores one case by pairing expected and detected items by index (the
 * scaffold's deterministic pairing rule; smarter matching can come later).
 * Expected items with no detected counterpart score zero for that pair.
 */
export function scoreCase(
  benchmarkCase: BenchmarkCase,
  detectedItems: NormalizedDetectedItem[],
): { fieldScores: PerFieldScores; overall: number } {
  const perItem = benchmarkCase.expectedItems.map((expected, index) => {
    const detected = detectedItems[index];
    return detected ? scoreFields(expected, detected) : zeroScores();
  });
  const fieldScores = averageFieldScores(perItem);
  return { fieldScores, overall: overallScore(fieldScores) };
}

function sanitizedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 300) || "Unknown provider error.";
}

/**
 * Runs every case sequentially against the injected provider, measuring
 * response time per case and never letting one failure abort the run.
 */
export async function runBenchmark(
  manifest: BenchmarkManifest,
  provider: BenchmarkProvider,
): Promise<BenchmarkRunResult> {
  const startedAt = new Date().toISOString();
  const caseResults: CaseBenchmarkResult[] = [];

  for (const benchmarkCase of manifest.cases) {
    const startedMs = Date.now();
    let detectedItems: NormalizedDetectedItem[] | null = null;
    let errorMessage: string | null = null;
    let status: CaseBenchmarkResult["status"] = "scored";

    try {
      const detected = await provider.detect(benchmarkCase);
      if (Array.isArray(detected)) {
        detectedItems = detected;
      } else {
        status = "invalid_output";
        errorMessage = "Provider returned a non-array result.";
      }
    } catch (error) {
      status = "provider_error";
      errorMessage = sanitizedErrorMessage(error);
    }
    const responseTimeMs = Date.now() - startedMs;

    if (detectedItems === null) {
      caseResults.push({
        caseId: benchmarkCase.id,
        imagePath: benchmarkCase.imagePath,
        status,
        responseTimeMs,
        errorMessage,
        fieldScores: null,
        overallScore: null,
      });
      continue;
    }

    const { fieldScores, overall } = scoreCase(benchmarkCase, detectedItems);
    caseResults.push({
      caseId: benchmarkCase.id,
      imagePath: benchmarkCase.imagePath,
      status: "scored",
      responseTimeMs,
      errorMessage: null,
      fieldScores,
      overallScore: overall,
    });
  }

  const scored = caseResults.filter((result) => result.status === "scored");
  const averageOverallScore =
    scored.length > 0
      ? scored.reduce((sum, result) => sum + (result.overallScore ?? 0), 0) / scored.length
      : null;
  const averageResponseTimeMs =
    caseResults.length > 0
      ? caseResults.reduce((sum, result) => sum + result.responseTimeMs, 0) / caseResults.length
      : null;

  return {
    manifestName: manifest.name,
    manifestVersion: manifest.version,
    startedAt,
    completedAt: new Date().toISOString(),
    totalCases: caseResults.length,
    scoredCases: scored.length,
    failedCases: caseResults.length - scored.length,
    averageOverallScore,
    averageResponseTimeMs,
    caseResults,
  };
}

function printUsage(): void {
  console.error(
    "Usage: bun benchmarks/fashion-scan/run.ts --validate <manifest.json>\n" +
      "This scaffold validates manifests only; live providers are wired in a later phase.",
  );
}

/** CLI entry point. Returns the intended process exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  const args = argv.slice(2);
  if (args[0] === "--validate" && typeof args[1] === "string" && args[1].length > 0) {
    try {
      const manifest = loadManifest(args[1]);
      console.log(
        `Manifest "${manifest.name}" (version ${manifest.version}) is valid: ` +
          `${manifest.cases.length} case(s), ` +
          `${manifest.cases.reduce((sum, c) => sum + c.expectedItems.length, 0)} expected item(s).`,
      );
      return 0;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  printUsage();
  return 1;
}

// Only run the CLI when executed directly (e.g. `bun benchmarks/fashion-scan/run.ts`),
// never when imported by tests.
if (process.argv[1]?.endsWith("run.ts")) {
  void main(process.argv).then((code) => {
    process.exitCode = code;
  });
}
