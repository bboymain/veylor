import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { FashionScanResult } from "../src/lib/fashion-scan";
import {
  BenchmarkManifestSchema,
  runFashionBenchmark,
  saveBenchmarkRun,
} from "./fashion-benchmark";

const returnedResult: FashionScanResult = {
  summary: "A black leather jacket is visible.",
  items: [
    {
      id: "item-1",
      category: "jacket",
      name: "black leather biker jacket",
      color: "black",
      material: "leather",
      style: "biker",
      pattern: null,
      visibleBrand: null,
      brandConfidence: 0,
      confidence: 0.92,
      searchQueries: ["black leather biker jacket"],
      affordableAlternativeQueries: ["affordable black leather biker jacket"],
      premiumAlternativeQueries: ["premium black leather biker jacket"],
    },
  ],
};

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), "veylor-benchmark-"));
  await mkdir(join(directory, "images"));
  await writeFile(join(directory, "images", "look-001.jpg"), Buffer.from([1, 2, 3]));
  await writeFile(
    join(directory, "manifest.json"),
    JSON.stringify({
      version: 1,
      cases: [
        {
          id: "look-001",
          image: "images/look-001.jpg",
          expectedItems: [
            {
              category: "jacket",
              color: "black",
              style: "biker",
              pattern: null,
              material: "leather",
              visibleBrand: null,
            },
          ],
        },
      ],
    }),
  );
  return directory;
}

describe("fashion benchmark", () => {
  test("validates required expected fashion labels", () => {
    expect(() =>
      BenchmarkManifestSchema.parse({
        version: 1,
        cases: [{ id: "look-001", image: "image.jpg", expectedItems: [{}] }],
      }),
    ).toThrow();
  });

  test("records raw Gemini results and saves them as JSON", async () => {
    const directory = await createFixture();
    try {
      const run = await runFashionBenchmark({
        manifestPath: join(directory, "manifest.json"),
        analyze: async () => returnedResult,
      });
      const outputPath = await saveBenchmarkRun(run, join(directory, "results", "run.json"));
      const saved = JSON.parse(await readFile(outputPath, "utf8")) as typeof run;

      expect(saved.totals).toEqual({ cases: 1, succeeded: 1, failed: 0 });
      expect(saved.cases[0]?.status).toBe("success");
      expect(saved.cases[0]?.expectedItems[0]?.category).toBe("jacket");
      if (saved.cases[0]?.status === "success") {
        expect(saved.cases[0].returned.items[0]?.material).toBe("leather");
        expect(saved.cases[0].responseTimeMs).toBeGreaterThanOrEqual(0);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("records an image failure and continues the run", async () => {
    const directory = await createFixture();
    try {
      await rm(join(directory, "images", "look-001.jpg"));
      const run = await runFashionBenchmark({
        manifestPath: join(directory, "manifest.json"),
        analyze: async () => returnedResult,
      });

      expect(run.totals).toEqual({ cases: 1, succeeded: 0, failed: 1 });
      expect(run.cases[0]?.status).toBe("failure");
      if (run.cases[0]?.status === "failure") {
        expect(run.cases[0].error.message).toContain("look-001.jpg");
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
