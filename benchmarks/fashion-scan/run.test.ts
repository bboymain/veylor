import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { BenchmarkCase, BenchmarkManifest, NormalizedDetectedItem } from "./schema";
import {
  loadManifest,
  parseManifest,
  runBenchmark,
  scoreCase,
  type BenchmarkProvider,
} from "./run";

const EXAMPLE_MANIFEST_PATH = fileURLToPath(new URL("./manifest.example.json", import.meta.url));

function perfectDetection(benchmarkCase: BenchmarkCase): NormalizedDetectedItem[] {
  return benchmarkCase.expectedItems.map((item) => ({
    category: item.category,
    colors: [...item.colors],
    pattern: item.pattern,
    material: item.material,
    styles: [...item.styles],
    visibleBrand: item.visibleBrand,
  }));
}

function stubProvider(
  detect: (benchmarkCase: BenchmarkCase) => Promise<NormalizedDetectedItem[]>,
): BenchmarkProvider {
  return { name: "stub", detect };
}

describe("manifest parsing", () => {
  test("loads and validates the example manifest, applying optional-field defaults", () => {
    const manifest = loadManifest(EXAMPLE_MANIFEST_PATH);
    expect(manifest.name).toBe("fashion-scan-example");
    expect(manifest.cases.length).toBe(3);
    // The second item of case 2 omits pattern/material/visibleBrand in JSON.
    const sparseItem = manifest.cases[1].expectedItems[1];
    expect(sparseItem.pattern).toBeNull();
    expect(sparseItem.material).toBeNull();
    expect(sparseItem.visibleBrand).toBeNull();
    expect(sparseItem.styles).toEqual(["casual"]);
  });

  test("rejects invalid JSON with a clear error", () => {
    expect(() => parseManifest("{ not json")).toThrow("Manifest is not valid JSON.");
  });

  test("rejects schema-invalid manifests with the failing path", () => {
    expect(() => parseManifest(JSON.stringify({ name: "x", version: 1, cases: [] }))).toThrow(
      "Manifest failed validation: cases",
    );
    expect(() =>
      parseManifest(
        JSON.stringify({
          name: "x",
          version: 1,
          cases: [{ id: "a", imagePath: "p.jpg", expectedItems: [{ category: "" }] }],
        }),
      ),
    ).toThrow("Manifest failed validation:");
  });

  test("reports unreadable manifest files without throwing raw fs errors", () => {
    expect(() => loadManifest("benchmarks/fashion-scan/does-not-exist.json")).toThrow(
      "Manifest file could not be read:",
    );
  });
});

describe("benchmark runner", () => {
  test("scores a perfect provider run at 1 and preserves case order", async () => {
    const manifest = loadManifest(EXAMPLE_MANIFEST_PATH);
    const provider = stubProvider(async (benchmarkCase) => perfectDetection(benchmarkCase));

    const run = await runBenchmark(manifest, provider);

    expect(run.totalCases).toBe(3);
    expect(run.scoredCases).toBe(3);
    expect(run.failedCases).toBe(0);
    expect(run.averageOverallScore).toBe(1);
    expect(run.caseResults.map((result) => result.caseId)).toEqual([
      "example-outfit-01",
      "example-outfit-02",
      "example-outfit-03",
    ]);
    for (const result of run.caseResults) {
      expect(result.status).toBe("scored");
      expect(result.overallScore).toBe(1);
      expect(result.responseTimeMs >= 0).toBe(true);
      expect(result.errorMessage).toBeNull();
    }
  });

  test("provider failures are captured per case and never abort the run", async () => {
    const manifest = loadManifest(EXAMPLE_MANIFEST_PATH);
    const provider = stubProvider(async (benchmarkCase) => {
      if (benchmarkCase.id === "example-outfit-02") {
        throw new Error("provider exploded");
      }
      return perfectDetection(benchmarkCase);
    });

    const run = await runBenchmark(manifest, provider);

    expect(run.totalCases).toBe(3);
    expect(run.scoredCases).toBe(2);
    expect(run.failedCases).toBe(1);
    const failed = run.caseResults.find((result) => result.caseId === "example-outfit-02");
    expect(failed?.status).toBe("provider_error");
    expect(failed?.errorMessage).toBe("provider exploded");
    expect(failed?.fieldScores).toBeNull();
    expect(failed?.overallScore).toBeNull();
  });

  test("an all-failing provider yields a null average score", async () => {
    const manifest = loadManifest(EXAMPLE_MANIFEST_PATH);
    const provider = stubProvider(async () => {
      throw new Error("down");
    });

    const run = await runBenchmark(manifest, provider);

    expect(run.scoredCases).toBe(0);
    expect(run.failedCases).toBe(3);
    expect(run.averageOverallScore).toBeNull();
  });

  test("non-array provider output is marked invalid_output", async () => {
    const manifest = loadManifest(EXAMPLE_MANIFEST_PATH);
    const provider = stubProvider(async () => null as unknown as NormalizedDetectedItem[]);

    const run = await runBenchmark(manifest, provider);

    expect(run.scoredCases).toBe(0);
    expect(run.caseResults.every((result) => result.status === "invalid_output")).toBe(true);
  });

  test("missing detected items score zero for their pair but keep results in range", () => {
    const manifest = loadManifest(EXAMPLE_MANIFEST_PATH);
    const twoItemCase = manifest.cases[1];
    const onlyFirstDetected = perfectDetection(twoItemCase).slice(0, 1);

    const { fieldScores, overall } = scoreCase(twoItemCase, onlyFirstDetected);

    expect(overall > 0 && overall < 1).toBe(true);
    for (const value of Object.values(fieldScores)) {
      expect(value >= 0 && value <= 1).toBe(true);
    }
  });

  test("repeated runs over the same inputs produce identical scores", async () => {
    const manifest: BenchmarkManifest = loadManifest(EXAMPLE_MANIFEST_PATH);
    const provider = stubProvider(async (benchmarkCase) =>
      perfectDetection(benchmarkCase).map((item) => ({ ...item, colors: ["black"] })),
    );

    const first = await runBenchmark(manifest, provider);
    const second = await runBenchmark(manifest, provider);

    expect(first.caseResults.map((result) => result.overallScore)).toEqual(
      second.caseResults.map((result) => result.overallScore),
    );
    expect(first.caseResults.map((result) => result.fieldScores)).toEqual(
      second.caseResults.map((result) => result.fieldScores),
    );
  });
});
