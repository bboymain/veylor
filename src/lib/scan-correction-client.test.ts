import { describe, expect, test } from "bun:test";
import {
  buildCorrectionPayload,
  correctionFieldFromLabel,
  normalizeCorrectionInput,
} from "./scan-correction-client";

describe("scan correction client", () => {
  test("maps only visible editor labels to allowed correction fields", () => {
    expect(correctionFieldFromLabel("Primary color")).toBe("color");
    expect(correctionFieldFromLabel(" Visible brand ")).toBe("visibleBrand");
    expect(correctionFieldFromLabel("Confidence")).toBeNull();
  });

  test("normalizes whitespace and blank nullable values", () => {
    expect(normalizeCorrectionInput("  deep   navy  ")).toBe("deep navy");
    expect(normalizeCorrectionInput("   ")).toBeNull();
  });

  test("does not send normalized no-op edits", () => {
    expect(
      buildCorrectionPayload(
        {
          searchId: "11111111-1111-4111-8111-111111111111",
          itemId: "item-1",
          fieldName: "style",
          previousValue: "smart casual",
        },
        " smart   casual ",
      ),
    ).toBeNull();
  });

  test("builds an explicit before and after payload for changed fields", () => {
    expect(
      buildCorrectionPayload(
        {
          searchId: "11111111-1111-4111-8111-111111111111",
          itemId: "item-1",
          fieldName: "material",
          previousValue: "polyester",
        },
        "cotton",
      ),
    ).toEqual({
      searchId: "11111111-1111-4111-8111-111111111111",
      itemId: "item-1",
      fieldName: "material",
      previousValue: "polyester",
      correctedValue: "cotton",
    });
  });
});
