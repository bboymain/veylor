import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import {
  caseIdempotencyKey,
  parseVisualManifest,
  VisualBenchmarkCaseSchema,
  type VisualBenchmarkCase,
} from "./schema";

const EXAMPLE_MANIFEST_PATH = fileURLToPath(new URL("./manifest.example.json", import.meta.url));

function exampleCaseJson(): Record<string, unknown> {
  return {
    id: "case-one",
    condition: "different_photo",
    category: "jacket",
    source: "unit-test fixture",
    privacy: "metadata_only",
    queryImage: { mockSignature: [1, 0, 0, 0] },
    candidates: [
      {
        id: "cand-one",
        image: { mockSignature: [0.9, 0.1, 0, 0] },
        expectedRelationship: "same_item",
      },
    ],
  };
}

describe("visual benchmark manifest schema", () => {
  test("loads and validates the metadata-only example manifest", () => {
    const manifest = parseVisualManifest(readFileSync(EXAMPLE_MANIFEST_PATH, "utf8"));
    expect(manifest.name).toBe("visual-item-memory-example");
    expect(manifest.cases.length).toBe(11);
    const conditions = new Set(manifest.cases.map((benchmarkCase) => benchmarkCase.condition));
    expect(conditions.size).toBe(10);
    // Metadata-only cases must not reference any image paths.
    for (const benchmarkCase of manifest.cases) {
      expect(benchmarkCase.queryImage.path).toBeNull();
      for (const candidate of benchmarkCase.candidates) {
        expect(candidate.image.path).toBeNull();
      }
    }
  });

  test("rejects invalid JSON and schema violations with clear errors", () => {
    expect(() => parseVisualManifest("{ nope")).toThrow("not valid JSON");
    expect(() => parseVisualManifest(JSON.stringify({ name: "x", version: 1, cases: [] }))).toThrow(
      "failed validation: cases",
    );
  });

  test("rejects duplicate case ids and duplicate candidate ids", () => {
    const single = exampleCaseJson();
    expect(() =>
      parseVisualManifest(JSON.stringify({ name: "d", version: 1, cases: [single, single] })),
    ).toThrow("Duplicate case id");

    const dupCandidates = exampleCaseJson();
    (dupCandidates.candidates as unknown[]).push((dupCandidates.candidates as unknown[])[0]);
    expect(() =>
      parseVisualManifest(JSON.stringify({ name: "d", version: 1, cases: [dupCandidates] })),
    ).toThrow("Duplicate candidate id");
  });

  test("requires a path or a mock signature on every image", () => {
    const broken = exampleCaseJson();
    broken.queryImage = { synthetic: true };
    expect(() =>
      parseVisualManifest(JSON.stringify({ name: "b", version: 1, cases: [broken] })),
    ).toThrow("failed validation");
  });

  test("rejects URLs and traversal segments in image paths", () => {
    const urlCase = exampleCaseJson();
    urlCase.privacy = "approved_private";
    urlCase.queryImage = { path: "https://example.com/photo.png" };
    expect(() =>
      parseVisualManifest(JSON.stringify({ name: "u", version: 1, cases: [urlCase] })),
    ).toThrow("failed validation");

    const traversalCase = exampleCaseJson();
    traversalCase.privacy = "approved_private";
    traversalCase.queryImage = { path: "../outside/secret.png" };
    expect(() =>
      parseVisualManifest(JSON.stringify({ name: "t", version: 1, cases: [traversalCase] })),
    ).toThrow("failed validation");
  });

  test("metadata_only cases must not carry image paths", () => {
    const leaky = exampleCaseJson();
    leaky.queryImage = { path: "private-images/query.png" };
    expect(() =>
      parseVisualManifest(JSON.stringify({ name: "l", version: 1, cases: [leaky] })),
    ).toThrow("failed validation");
  });

  test("case idempotency keys are stable and content-sensitive", () => {
    const parsed: VisualBenchmarkCase = VisualBenchmarkCaseSchema.parse(exampleCaseJson());
    const again: VisualBenchmarkCase = VisualBenchmarkCaseSchema.parse(exampleCaseJson());
    expect(caseIdempotencyKey(parsed)).toBe(caseIdempotencyKey(again));

    const changed = VisualBenchmarkCaseSchema.parse({
      ...exampleCaseJson(),
      candidates: [
        {
          id: "cand-one",
          image: { mockSignature: [0.9, 0.1, 0, 0] },
          expectedRelationship: "different_item",
        },
      ],
    });
    expect(caseIdempotencyKey(changed)).not.toBe(caseIdempotencyKey(parsed));
  });
});
