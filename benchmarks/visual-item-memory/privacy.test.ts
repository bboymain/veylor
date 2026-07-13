import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLoopbackUrl } from "./local-provider";
import { InMemoryVisualBenchmarkPersistence, persistVisualBenchmarkRun } from "./persistence";
import { loadVisualManifest } from "./run";

// Privacy and trust-boundary guarantees for the PRIVATE visual item-memory
// benchmark. These tests are intentionally about what the suite must NEVER
// do: expose benchmark assets publicly, call paid or remote services, or
// touch production verification, acceptance, cache, ranking, benchmark
// promotion, or model state.

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SUITE_DIR = fileURLToPath(new URL(".", import.meta.url));
const EXAMPLE_MANIFEST_PATH = join(SUITE_DIR, "manifest.example.json");

const PRIVATE_DIRECTORIES = new Set(["results", "private-images", "node_modules"]);

function walkFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      if (PRIVATE_DIRECTORIES.has(entry)) continue;
      files.push(...walkFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

const FORBIDDEN_PRODUCTION_TOUCHPOINTS = [
  // Production server modules that mutate verification/acceptance/cache/ranking.
  "product-verification.server",
  "product-acceptance.server",
  "product-ranking.server",
  "scan-cache.server",
  "alternative-impressions.server",
  "product-persistence.server",
  "search-logging.server",
  // Model-promotion and Supabase benchmark RPCs (Stage 32/34).
  "set_fashion_benchmark_baseline",
  "evaluate_fashion_benchmark_promotion",
  "start_fashion_benchmark_run",
  "record_fashion_benchmark_result",
  "complete_fashion_benchmark_run",
  "upsert_fashion_benchmark_case",
  "accept_alternative_match",
  "record_alternative_impressions",
  // Direct Supabase REST access of any kind.
  "/rest/v1",
  "SUPABASE_SERVICE_ROLE_KEY",
  // Paid / hosted model providers.
  "generativelanguage.googleapis",
  "api.openai.com",
  "serpapi.com",
];

describe("benchmark isolation from production systems", () => {
  test("no visual benchmark module references production mutation paths, Supabase, or paid providers", () => {
    const sources = walkFiles(SUITE_DIR)
      .filter((file) => /\.(ts|json)$/.test(file))
      .filter((file) => basename(file) !== "privacy.test.ts");
    sources.push(join(REPO_ROOT, "scripts", "visual-memory-benchmark.ts"));

    const violations: string[] = [];
    for (const file of sources) {
      const content = readFileSync(file, "utf8");
      for (const forbidden of FORBIDDEN_PRODUCTION_TOUCHPOINTS) {
        if (content.includes(forbidden)) {
          violations.push(`${basename(file)} references "${forbidden}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("benchmark runs cannot promote models or change verification, acceptance, or cache state", () => {
    // Structural guarantee: the persistence layer's only write surface is
    // saveRun on an injected persistence object; there is no Supabase client,
    // no RPC name, and no production import anywhere in the suite (asserted
    // above), so no run can reach verification, acceptance, cache, ranking,
    // or promotion state.
    const persistence = new InMemoryVisualBenchmarkPersistence();
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(persistence)).filter(
      (name) => name !== "constructor",
    );
    expect(surface.sort()).toEqual(["getRunStatus", "saveRun"]);
  });

  test("dry-run persistence writes nothing even with a real manifest", async () => {
    const manifest = loadVisualManifest(EXAMPLE_MANIFEST_PATH);
    const persistence = new InMemoryVisualBenchmarkPersistence();
    const outcome = await persistVisualBenchmarkRun(
      manifest,
      { provider: "mock", model: "m", modelVersion: "1", embeddingDimension: 32 },
      { topK: 3, thresholds: [0.9], batchSize: 8 },
      { anything: true },
      persistence,
      { dryRun: true },
    );
    expect(outcome.writesPerformed).toBe(0);
    expect(persistence.writeCalls).toBe(0);
    expect(persistence.statusCalls).toBe(0);
  });
});

describe("no public exposure of benchmark assets or results", () => {
  test("no route or client module references the visual benchmark suite", () => {
    const violations: string[] = [];
    for (const file of walkFiles(join(REPO_ROOT, "src", "routes"))) {
      if (readFileSync(file, "utf8").toLowerCase().includes("benchmark")) {
        violations.push(`route ${basename(file)} references benchmarks`);
      }
    }
    const srcFiles = walkFiles(join(REPO_ROOT, "src")).filter(
      (file) => /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file),
    );
    for (const file of srcFiles) {
      const content = readFileSync(file, "utf8");
      if (content.includes("visual-item-memory") || content.includes("benchmarks/")) {
        violations.push(`src ${basename(file)} references the benchmark suite`);
      }
    }
    expect(violations).toEqual([]);
  });

  test("private image and result directories are gitignored", () => {
    const gitignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");
    expect(gitignore).toContain("benchmarks/visual-item-memory/results/");
    expect(gitignore).toContain("benchmarks/visual-item-memory/private-images/");
    expect(gitignore).toContain("benchmarks/visual-item-memory/manifest.local.json");
  });

  test("no images or local manifests are committed inside the suite", () => {
    const suiteFiles = walkFiles(SUITE_DIR);
    const binaries = suiteFiles.filter((file) => /\.(png|jpe?g|webp|gif|bmp)$/i.test(file));
    expect(binaries).toEqual([]);
    expect(existsSync(join(SUITE_DIR, "manifest.local.json"))).toBe(false);
  });

  test("the committed example manifest is metadata-only with no image paths or URLs", () => {
    const manifest = loadVisualManifest(EXAMPLE_MANIFEST_PATH);
    for (const benchmarkCase of manifest.cases) {
      expect(benchmarkCase.privacy).toBe("metadata_only");
      expect(benchmarkCase.queryImage.path).toBeNull();
      for (const candidate of benchmarkCase.candidates) {
        expect(candidate.image.path).toBeNull();
      }
    }
    const rawText = readFileSync(EXAMPLE_MANIFEST_PATH, "utf8");
    expect(/https?:\/\//.test(rawText)).toBe(false);
  });
});

describe("local provider stays local", () => {
  test("accepts only loopback URLs", () => {
    expect(() => assertLoopbackUrl("http://127.0.0.1:11434")).not.toThrow();
    expect(() => assertLoopbackUrl("http://localhost:8080")).not.toThrow();
    expect(() => assertLoopbackUrl("https://api.openai.example")).toThrow("loopback");
    expect(() => assertLoopbackUrl("https://embeddings.example.com")).toThrow("loopback");
    expect(() => assertLoopbackUrl("http://10.0.0.5:11434")).toThrow("loopback");
    expect(() => assertLoopbackUrl("not-a-url")).toThrow("valid URL");
  });
});
