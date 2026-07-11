import { describe, expect, test } from "bun:test";
import type { FashionScanItem } from "../src/lib/fashion-scan";
import { scoreBenchmarkItems, scoreField } from "./fashion-benchmark-scoring";

function returnedItem(overrides: Partial<FashionScanItem> = {}): FashionScanItem {
  return {
    id: "item-1",
    category: "jacket",
    name: "black jacket",
    color: "black",
    material: "leather",
    style: "biker",
    pattern: null,
    visibleBrand: null,
    brandConfidence: 0,
    confidence: 0.9,
    searchQueries: ["black jacket"],
    affordableAlternativeQueries: ["affordable black jacket"],
    premiumAlternativeQueries: ["premium black jacket"],
    ...overrides,
  };
}

const expectedItem = {
  category: "jacket",
  color: "black",
  style: "biker",
  pattern: null,
  material: "leather",
  visibleBrand: null,
};

describe("fashion benchmark scoring", () => {
  test("normalizes exact values and recognizes configured equivalents as close", () => {
    expect(scoreField("category", "T-Shirt", "t shirt").status).toBe("exact");
    expect(scoreField("category", "top", "T-shirt").status).toBe("close");
    expect(scoreField("category", "sleeveless t-shirt", "tank top").status).toBe("close");
    expect(scoreField("color", "tan", "beige").status).toBe("close");
    expect(scoreField("color", "off-white", "cream").status).toBe("close");
  });

  test("distinguishes wrong and unknown values and counts brand hallucinations", () => {
    expect(scoreField("material", "leather", "cotton").status).toBe("wrong");
    expect(scoreField("material", "leather", null).status).toBe("unknown");
    expect(scoreField("pattern", null, "striped").status).toBe("unknown");

    const scores = scoreBenchmarkItems([expectedItem], [returnedItem({ visibleBrand: "Nike" })]);
    expect(scores.items[0]?.fields.visibleBrand.status).toBe("wrong");
    expect(scores.totals.brandHallucinations).toBe(1);
  });

  test("selects the returned item with the strongest field match", () => {
    const scores = scoreBenchmarkItems(
      [expectedItem],
      [
        returnedItem({
          id: "item-wrong",
          category: "shoes",
          color: "white",
          material: "canvas",
          style: "athletic",
        }),
        returnedItem({ id: "item-best" }),
      ],
    );

    expect(scores.items[0]?.returnedItemId).toBe("item-best");
    expect(scores.totals).toEqual({
      exact: 4,
      close: 0,
      wrong: 0,
      unknown: 2,
      brandHallucinations: 0,
    });
  });
});
