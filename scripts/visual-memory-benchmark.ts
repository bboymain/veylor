import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  loadVisualManifest,
  runVisualBenchmarkIntegrated,
  type VisualBenchmarkRunResult,
} from "../benchmarks/visual-item-memory/run";
import { buildThresholdRange } from "../benchmarks/visual-item-memory/evaluate";
import {
  createDeterministicMockProvider,
  type VisualEmbeddingProvider,
} from "../benchmarks/visual-item-memory/provider";
import { createLocalEmbeddingProvider } from "../benchmarks/visual-item-memory/local-provider";
import {
  InMemoryVisualBenchmarkPersistence,
  LocalJsonVisualBenchmarkPersistence,
  type VisualBenchmarkPersistence,
} from "../benchmarks/visual-item-memory/persistence";
import {
  decodePng,
  encodePng,
  generateSyntheticItemImage,
  generateVariantSet,
} from "../benchmarks/visual-item-memory/variants";

// PRIVATE CLI for the Stage 2A visual item-memory feasibility benchmark.
//
//   bun scripts/visual-memory-benchmark.ts run --manifest <path> [flags]
//   bun scripts/visual-memory-benchmark.ts validate --manifest <path>
//   bun scripts/visual-memory-benchmark.ts make-synthetic --out <dir> [--count n]
//   bun scripts/visual-memory-benchmark.ts make-variants --source <png> --out <dir>
//
// Defaults are safe: the deterministic mock provider, a threshold sweep (no
// production threshold), and results written only to the untracked private
// results directory. --dry-run / --no-write guarantee zero writes anywhere.

const DEFAULT_MANIFEST = "benchmarks/visual-item-memory/manifest.example.json";
const DEFAULT_RESULTS_DIR = "benchmarks/visual-item-memory/results";
const DEFAULT_THRESHOLDS = "0.5:0.95:0.05";
const DEFAULT_TOP_K = 3;
const DEFAULT_BATCH_SIZE = 16;

type CliFlags = Map<string, string | boolean>;

export function parseFlags(args: readonly string[]): { command: string; flags: CliFlags } {
  const [first, ...rest] = args;
  const command = first && !first.startsWith("--") ? first : "run";
  const flagArgs = first && !first.startsWith("--") ? rest : args;
  const flags: CliFlags = new Map();
  for (let index = 0; index < flagArgs.length; index += 1) {
    const argument = flagArgs[index];
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    const name = argument.slice(2);
    const next = flagArgs[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(name, next);
      index += 1;
    } else {
      flags.set(name, true);
    }
  }
  return { command, flags };
}

function stringFlag(flags: CliFlags, name: string, fallback?: string): string | undefined {
  const value = flags.get(name);
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw new Error(`--${name} requires a value.`);
  return value;
}

function numberFlag(flags: CliFlags, name: string, fallback: number): number {
  const raw = stringFlag(flags, name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number.`);
  return parsed;
}

export function parseThresholdSpec(spec: string): number[] {
  const parts = spec.split(":").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error("--thresholds must look like start:end:step, e.g. 0.5:0.95:0.05");
  }
  return buildThresholdRange(parts[0], parts[1], parts[2]);
}

function buildProvider(flags: CliFlags): VisualEmbeddingProvider {
  const providerName = stringFlag(flags, "provider", "mock");
  if (providerName === "mock") {
    const dimension = numberFlag(flags, "dimension", 32);
    return createDeterministicMockProvider({ dimension });
  }
  if (providerName === "local") {
    const model = stringFlag(flags, "local-model");
    if (!model) {
      throw new Error(
        "--provider local requires --local-model. The local provider only talks to a " +
          "loopback embedding server you already run yourself; nothing is downloaded.",
      );
    }
    return createLocalEmbeddingProvider({
      baseUrl: stringFlag(flags, "local-url", "http://127.0.0.1:11434"),
      model,
      dimension: Math.trunc(numberFlag(flags, "dimension", 0)),
    });
  }
  throw new Error(`Unknown provider "${String(providerName)}". Use mock or local.`);
}

function formatSweepTable(run: VisualBenchmarkRunResult): string {
  const lines = ["threshold  recall  fpr     fnr     precision  tp/fp/tn/fn"];
  for (const entry of run.metrics.thresholdSweep) {
    const fmt = (value: number | null): string =>
      value === null ? "  n/a " : value.toFixed(3).padStart(6);
    const c = entry.confusion;
    lines.push(
      `${entry.threshold.toFixed(2).padStart(9)}  ${fmt(entry.sameItemRecall)}  ${fmt(
        entry.falsePositiveRate,
      )}  ${fmt(entry.falseNegativeRate)}  ${fmt(entry.precision)}     ` +
        `${c.truePositives}/${c.falsePositives}/${c.trueNegatives}/${c.falseNegatives}`,
    );
  }
  return lines.join("\n");
}

function printTextReport(run: VisualBenchmarkRunResult, verbose: boolean): void {
  const m = run.metrics;
  console.log(
    `Visual item-memory benchmark "${run.manifestName}" v${run.manifestVersion} — ` +
      `provider ${run.provider.provider}/${run.provider.model}@${run.provider.modelVersion} ` +
      `(dim ${run.provider.embeddingDimension})`,
  );
  console.log(
    `Cases: ${m.totalCases} total, ${m.evaluatedCases} evaluated, ${m.failedCases} failed.`,
  );
  const pct = (value: number | null): string =>
    value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
  console.log(
    `Top-1 accuracy: ${pct(m.top1Accuracy)}; same-item recall@${m.topK}: ${pct(m.sameItemRecallAtK)}.`,
  );
  console.log(
    `Latency: mean ${run.latency.meanMs?.toFixed(2) ?? "n/a"} ms, ` +
      `p95 ${run.latency.p95Ms?.toFixed(2) ?? "n/a"} ms over ${run.latency.images} images.`,
  );
  console.log("Threshold sweep (recall vs false positives — no production threshold chosen):");
  console.log(formatSweepTable(run));
  if (run.failures.length > 0) {
    console.log(`Failures (${run.failures.length}):`);
    for (const failure of verbose ? run.failures : run.failures.slice(0, 5)) {
      console.log(`  - ${failure}`);
    }
    if (!verbose && run.failures.length > 5) {
      console.log(`  … ${run.failures.length - 5} more (use --verbose).`);
    }
  }
  if (verbose) {
    console.log("Per-condition metrics:");
    for (const [condition, group] of Object.entries(m.perCondition)) {
      console.log(
        `  ${condition}: top1 ${pct(group.top1Accuracy)}, ` +
          `same-mean ${group.meanSameItemSimilarity?.toFixed(3) ?? "n/a"}, ` +
          `margin ${group.separationMargin?.toFixed(3) ?? "n/a"}`,
      );
    }
  }
}

async function commandRun(flags: CliFlags): Promise<number> {
  const manifestPath = resolve(stringFlag(flags, "manifest", DEFAULT_MANIFEST) ?? DEFAULT_MANIFEST);
  const manifest = loadVisualManifest(manifestPath);
  const provider = buildProvider(flags);
  const dryRun = flags.get("dry-run") === true || flags.get("no-write") === true;
  const verbose = flags.get("verbose") === true;
  const format = stringFlag(flags, "format", "text");
  if (format !== "text" && format !== "json") throw new Error("--format must be text or json.");

  const config = {
    topK: Math.trunc(numberFlag(flags, "top-k", DEFAULT_TOP_K)),
    thresholds: parseThresholdSpec(
      stringFlag(flags, "thresholds", DEFAULT_THRESHOLDS) ?? DEFAULT_THRESHOLDS,
    ),
    batchSize: Math.trunc(numberFlag(flags, "batch-size", DEFAULT_BATCH_SIZE)),
  };

  const persistence: VisualBenchmarkPersistence = dryRun
    ? new InMemoryVisualBenchmarkPersistence()
    : new LocalJsonVisualBenchmarkPersistence(
        resolve(stringFlag(flags, "out", DEFAULT_RESULTS_DIR) ?? DEFAULT_RESULTS_DIR),
      );

  const { run, persistence: outcome } = await runVisualBenchmarkIntegrated(
    manifest,
    provider,
    config,
    persistence,
    { dryRun, idempotencyKey: stringFlag(flags, "idempotency-key") },
  );

  if (format === "json") {
    console.log(JSON.stringify({ run, persistence: outcome }, null, 2));
  } else {
    printTextReport(run, verbose);
    if (dryRun) {
      console.log(`Dry run: zero writes performed (writesPerformed=${outcome.writesPerformed}).`);
    } else if (outcome.alreadyCompleted) {
      console.log(`Run ${outcome.runId} already recorded; nothing new written.`);
    } else {
      console.log(
        `Saved run ${outcome.runId} (idempotency ${outcome.idempotencyKey.slice(0, 12)}…).`,
      );
    }
  }
  if (dryRun && outcome.writesPerformed !== 0) {
    console.error("Dry run performed writes — this is a bug.");
    return 1;
  }
  return run.metrics.failedCases > 0 ? 1 : 0;
}

function commandValidate(flags: CliFlags): number {
  const manifestPath = resolve(stringFlag(flags, "manifest", DEFAULT_MANIFEST) ?? DEFAULT_MANIFEST);
  const manifest = loadVisualManifest(manifestPath);
  const candidateCount = manifest.cases.reduce(
    (sum, benchmarkCase) => sum + benchmarkCase.candidates.length,
    0,
  );
  console.log(
    `Manifest "${manifest.name}" (version ${manifest.version}) is valid: ` +
      `${manifest.cases.length} case(s), ${candidateCount} candidate(s).`,
  );
  return 0;
}

function commandMakeSynthetic(flags: CliFlags): number {
  const outDir = stringFlag(flags, "out");
  if (!outDir) throw new Error("make-synthetic requires --out <directory>.");
  const count = Math.trunc(numberFlag(flags, "count", 3));
  if (count < 1 || count > 50) throw new Error("--count must be between 1 and 50.");
  const resolvedOut = resolve(outDir);
  mkdirSync(resolvedOut, { recursive: true });
  const written: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const seed = `veylor-synthetic-item-${index + 1}`;
    const image = generateSyntheticItemImage(seed);
    const path = join(resolvedOut, `${seed}.png`);
    writeFileSync(path, encodePng(image));
    written.push(path);
  }
  console.log(`Wrote ${written.length} synthetic fixture image(s) to ${resolvedOut}.`);
  console.log("These are synthetic patterns, not real product photos; label them as such.");
  return 0;
}

function commandMakeVariants(flags: CliFlags): number {
  const sourcePath = stringFlag(flags, "source");
  const outDir = stringFlag(flags, "out");
  if (!sourcePath || !outDir) {
    throw new Error("make-variants requires --source <png> and --out <directory>.");
  }
  const source = decodePng(readFileSync(resolve(sourcePath)));
  const resolvedOut = resolve(outDir);
  mkdirSync(resolvedOut, { recursive: true });
  const stem = basename(sourcePath).replace(/\.png$/i, "");
  const manifestEntries: Array<Record<string, unknown>> = [];
  for (const variant of generateVariantSet(source)) {
    const fileName = `${stem}__${variant.kind}.png`;
    writeFileSync(join(resolvedOut, fileName), encodePng(variant.image));
    manifestEntries.push({
      file: fileName,
      kind: variant.kind,
      synthetic: true,
      sourceFile: basename(sourcePath),
      transform: variant.transform,
      note: "Synthetic perturbation — NOT equivalent to a real different-user photo.",
    });
  }
  const metadataPath = join(resolvedOut, `${stem}__variants.json`);
  writeFileSync(metadataPath, `${JSON.stringify(manifestEntries, null, 2)}\n`, "utf8");
  console.log(`Wrote ${manifestEntries.length} synthetic variants and ${metadataPath}.`);
  return 0;
}

/** CLI entry point. Returns the intended process exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  try {
    const { command, flags } = parseFlags(argv.slice(2));
    if (command === "run") return await commandRun(flags);
    if (command === "validate") return commandValidate(flags);
    if (command === "make-synthetic") return commandMakeSynthetic(flags);
    if (command === "make-variants") return commandMakeVariants(flags);
    console.error(
      "Usage: bun scripts/visual-memory-benchmark.ts " +
        "[run|validate|make-synthetic|make-variants] [--flags]\n" +
        "Run flags: --manifest <path> --provider mock|local --dry-run --no-write " +
        "--thresholds start:end:step --top-k n --batch-size n --format text|json " +
        "--out <dir> --idempotency-key <key> --dimension n --local-url <loopback> " +
        "--local-model <name> --verbose",
    );
    return 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) {
  void main(process.argv).then((code) => {
    process.exitCode = code;
  });
}
