import { describe, expect, test } from "bun:test";
import { GEMINI_MODEL, mapGeminiError, parseGeminiFashionContent } from "./gemini-fashion";

const validGeminiResult = {
  summary: "Black Nike T-shirt and gray pants are visible.",
  items: [
    {
      id: "item-1",
      category: "top",
      name: "black logo crew neck T-shirt",
      color: "black",
      material: "cotton",
      style: "casual",
      pattern: "logo graphic",
      visibleBrand: "Nike",
      brandConfidence: 0.92,
      confidence: 0.88,
      searchQueries: ["Nike black logo crew neck T-shirt"],
      affordableAlternativeQueries: ["affordable black logo crew neck T-shirt"],
      premiumAlternativeQueries: ["premium black logo crew neck T-shirt"],
    },
  ],
};

async function responseErrorCode(response: Response) {
  const payload = (await response.json()) as { error: { code: string } };
  return payload.error.code;
}

describe("Gemini fashion provider", () => {
  test("uses Gemini 2.5 Flash", () => {
    expect(GEMINI_MODEL).toBe("gemini-2.5-flash");
  });

  test("validates a structured Gemini fashion response", () => {
    const result = parseGeminiFashionContent(JSON.stringify(validGeminiResult));

    expect(result.items[0].visibleBrand).toBe("Nike");
    expect(result.items[0].confidence).toBe(0.88);
  });

  test("rejects malformed Gemini output", () => {
    expect(() => parseGeminiFashionContent(JSON.stringify({ summary: "missing items" }))).toThrow();
  });

  test("maps missing API key to a public error", async () => {
    const response = mapGeminiError(new Error("Missing Gemini API key."));

    expect(await responseErrorCode(response)).toBe("GEMINI_API_KEY_MISSING");
  });

  test("maps rate limits to a public error", async () => {
    const response = mapGeminiError({ status: 429, message: "quota exceeded" });

    expect(await responseErrorCode(response)).toBe("GEMINI_RATE_LIMIT");
  });
});
