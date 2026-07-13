import { describe, expect, test } from "bun:test";
import { cosineSimilarity } from "./evaluate";
import {
  createDeterministicMockProvider,
  expandSignature,
  normalizeVector,
  seededUnitVector,
  type EmbeddingInput,
} from "./provider";

function input(
  imageId: string,
  mockSignature: number[] | null,
  path: string | null = null,
): EmbeddingInput {
  return { imageId, image: { path, mockSignature, synthetic: false } };
}

describe("deterministic mock embedding provider", () => {
  test("is deterministic across calls and instances", async () => {
    const providerA = createDeterministicMockProvider();
    const providerB = createDeterministicMockProvider();
    const inputs = [input("a", [1, 0.2, 0.1, 0]), input("b", null, "private/x.png")];
    const first = await providerA.embedBatch(inputs);
    const second = await providerB.embedBatch(inputs);
    expect(first[0].embedding).toEqual(second[0].embedding);
    expect(first[1].embedding).toEqual(second[1].embedding);
  });

  test("produces unit-normalized vectors of the configured dimension", async () => {
    const provider = createDeterministicMockProvider({ dimension: 48 });
    const [result] = await provider.embedBatch([input("a", [0.5, 0.5])]);
    expect(result.embedding).not.toBeNull();
    expect(result.embedding).toHaveLength(48);
    const norm = Math.sqrt(result.embedding!.reduce((sum, value) => sum + value * value, 0));
    expect(Math.abs(norm - 1)).toBeLessThan(1e-9);
  });

  test("signature expansion preserves authored cosine structure exactly", () => {
    const sigA = [1, 0.05, 0.02, 0.01];
    const sigB = [0.8, 0.55, 0.1, 0.05];
    const direct = cosineSimilarity(sigA, sigB);
    const expanded = cosineSimilarity(
      normalizeVector(expandSignature(sigA, 32))!,
      normalizeVector(expandSignature(sigB, 32))!,
    );
    expect(Math.abs(direct - expanded)).toBeLessThan(1e-9);
  });

  test("images without signatures embed to stable pseudo-random unit vectors", () => {
    const one = seededUnitVector("private/a.png", 32);
    const two = seededUnitVector("private/a.png", 32);
    const other = seededUnitVector("private/b.png", 32);
    expect(one).toEqual(two);
    expect(Math.abs(cosineSimilarity(one, other))).toBeLessThan(0.6);
  });

  test("reports configured per-image failures without throwing", async () => {
    const provider = createDeterministicMockProvider({ failImageIds: ["broken"] });
    const results = await provider.embedBatch([input("ok", [1, 0]), input("broken", [1, 0])]);
    expect(results[0].error).toBeNull();
    expect(results[1].embedding).toBeNull();
    expect(results[1].error).toContain("configured to fail");
  });

  test("rejects unusable dimensions", () => {
    expect(() => createDeterministicMockProvider({ dimension: 1 })).toThrow("dimension");
    expect(() => createDeterministicMockProvider({ dimension: 10_000 })).toThrow("dimension");
  });

  test("measures latency as a non-negative number per image", async () => {
    const provider = createDeterministicMockProvider();
    const results = await provider.embedBatch([input("a", [1, 0]), input("b", [0, 1])]);
    for (const result of results) {
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(result.latencyMs)).toBe(true);
    }
  });
});
