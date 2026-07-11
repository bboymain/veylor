import { describe, expect, test } from "bun:test";
import type { ExpectedFashionItem, NormalizedDetectedItem, PerFieldScores } from "./schema";
import {
  DEFAULT_FIELD_WEIGHTS,
  isBrandHallucination,
  normalizeLabel,
  normalizeLabelList,
  overallScore,
  scoreCategory,
  scoreColors,
  scoreExactLabel,
  scoreFields,
  scoreLabelOverlap,
  scoreStyles,
  scoreVisibleBrand,
} from "./score";

const expectedItem: ExpectedFashionItem = {
  category: "top",
  colors: ["black", "white"],
  pattern: "graphic print",
  material: "cotton",
  styles: ["streetwear", "casual"],
  visibleBrand: null,
};

function detected(overrides: Partial<NormalizedDetectedItem>): NormalizedDetectedItem {
  return {
    category: "top",
    colors: ["black", "white"],
    pattern: "graphic print",
    material: "cotton",
    styles: ["streetwear", "casual"],
    visibleBrand: null,
    ...overrides,
  };
}

describe("normalization", () => {
  test("normalizes casing and whitespace and treats blanks as missing", () => {
    expect(normalizeLabel("  Graphic   PRINT ")).toBe("graphic print");
    expect(normalizeLabel("   ")).toBeNull();
    expect(normalizeLabel(null)).toBeNull();
    expect(normalizeLabel(undefined)).toBeNull();
    expect(normalizeLabelList([" Black ", "black", "", null, "WHITE"])).toEqual(["black", "white"]);
    expect(normalizeLabelList(null)).toEqual([]);
  });
});

describe("category accuracy", () => {
  test("exact category match scores 1 regardless of casing", () => {
    expect(scoreCategory("Top", "top")).toBe(1);
    expect(scoreCategory("top", "  TOP ")).toBe(1);
  });

  test("wrong or missing category scores 0", () => {
    expect(scoreCategory("top", "jacket")).toBe(0);
    expect(scoreCategory("top", null)).toBe(0);
    expect(scoreCategory("top", undefined)).toBe(0);
  });
});

describe("list overlap", () => {
  test("partial color overlap uses Jaccard", () => {
    // intersection {black} = 1, union {black, white, red} = 3.
    expect(scoreColors(["black", "white"], ["black", "red"])).toBe(1 / 3);
  });

  test("full color match scores 1 and disjoint sets score 0", () => {
    expect(scoreColors(["black", "white"], ["WHITE", " black "])).toBe(1);
    expect(scoreColors(["black"], ["red"])).toBe(0);
  });

  test("style overlap behaves the same way", () => {
    expect(scoreStyles(["streetwear", "casual"], ["casual"])).toBe(1 / 2);
    expect(scoreStyles([], [])).toBe(1);
    expect(scoreStyles(["casual"], [])).toBe(0);
  });
});

describe("missing optional fields", () => {
  test("both sides missing scores 1; one side missing scores 0", () => {
    expect(scoreExactLabel(null, null)).toBe(1);
    expect(scoreExactLabel(null, "cotton")).toBe(0);
    expect(scoreExactLabel("cotton", null)).toBe(0);
    expect(scoreLabelOverlap([], [])).toBe(1);
  });
});

describe("visible-brand accuracy and hallucination", () => {
  test("matching brand scores 1 case-insensitively", () => {
    expect(scoreVisibleBrand("Levi's", " levi's ")).toBe(1);
  });

  test("expected brand missing from detection scores 0 without hallucination", () => {
    expect(scoreVisibleBrand("Levi's", null)).toBe(0);
    expect(isBrandHallucination("Levi's", null)).toBe(false);
  });

  test("a brand detected when none was expected is a hallucination", () => {
    expect(scoreVisibleBrand(null, "Gucci")).toBe(0);
    expect(isBrandHallucination(null, "Gucci")).toBe(true);
  });

  test("a mismatched detected brand is a hallucination", () => {
    expect(isBrandHallucination("Levi's", "Gucci")).toBe(true);
    expect(isBrandHallucination("Levi's", "levi's")).toBe(false);
  });

  test("hallucination zeroes the brandHallucination field score", () => {
    const scores = scoreFields(expectedItem, detected({ visibleBrand: "Gucci" }));
    expect(scores.brandHallucination).toBe(0);
    expect(scores.visibleBrand).toBe(0);
  });
});

describe("score ranges and weighting", () => {
  const fixtures: Array<[ExpectedFashionItem, NormalizedDetectedItem]> = [
    [expectedItem, detected({})],
    [expectedItem, detected({ category: null, colors: [], styles: [] })],
    [expectedItem, detected({ visibleBrand: "Invented Brand" })],
    [
      { ...expectedItem, visibleBrand: "Levi's", colors: [], styles: [] },
      detected({ colors: ["neon green"], pattern: null, material: "steel" }),
    ],
  ];

  test("every field score and overall score stays within [0, 1]", () => {
    for (const [expected, detectedItem] of fixtures) {
      const scores = scoreFields(expected, detectedItem);
      for (const key of Object.keys(scores) as (keyof PerFieldScores)[]) {
        expect(scores[key] >= 0 && scores[key] <= 1).toBe(true);
      }
      const overall = overallScore(scores);
      expect(overall >= 0 && overall <= 1).toBe(true);
    }
  });

  test("default weights sum to 1 and perfect/zero fields hit the bounds", () => {
    const weightSum = Object.values(DEFAULT_FIELD_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(Math.abs(weightSum - 1) < 1e-9).toBe(true);

    const perfect = scoreFields(expectedItem, detected({}));
    expect(overallScore(perfect)).toBe(1);

    const worst: PerFieldScores = {
      category: 0,
      colors: 0,
      pattern: 0,
      material: 0,
      styles: 0,
      visibleBrand: 0,
      brandHallucination: 0,
    };
    expect(overallScore(worst)).toBe(0);
  });

  test("repeated scoring is deterministic", () => {
    const first = scoreFields(expectedItem, detected({ colors: ["black", "red"] }));
    const second = scoreFields(expectedItem, detected({ colors: ["black", "red"] }));
    expect(first).toEqual(second);
    expect(overallScore(first)).toBe(overallScore(second));
  });
});
