import { describe, expect, test } from "bun:test";
import {
  analyzeFashionWithOllama,
  checkOllamaHealth,
  mapOllamaError,
  MAX_IMAGE_BYTES,
  OllamaFashionResultSchema,
  parseDataUrlImage,
  parseOllamaFashionContent,
} from "./ollama-fashion";

const validFashionResult = {
  category: "outerwear",
  subcategory: "bomber jacket",
  itemName: "oversized faux leather bomber jacket",
  primaryColor: "black",
  secondaryColors: [],
  pattern: "solid",
  likelyMaterial: "faux leather",
  style: ["streetwear", "casual"],
  fit: "oversized",
  silhouette: "boxy",
  sleeveLength: "long sleeve",
  neckline: null,
  shoeType: null,
  accessoryType: null,
  visibleText: null,
  possibleBrand: null,
  confidence: 0.82,
  searchKeywords: [
    "black oversized bomber jacket",
    "black faux leather bomber jacket",
    "oversized streetwear leather jacket",
  ],
  warnings: [],
};

function jsonResponse(body: unknown, ok = true, status = 200) {
  return new Response(JSON.stringify(body), { status: ok ? status : status || 500 });
}

async function responseErrorCode(response: Response) {
  const payload = (await response.json()) as { error: { code: string } };
  return payload.error.code;
}

describe("Ollama fashion provider", () => {
  test("validates a valid Ollama fashion response", () => {
    const result = parseOllamaFashionContent(JSON.stringify(validFashionResult));

    expect(result.itemName).toBe("oversized faux leather bomber jacket");
    expect(result.confidence).toBe(0.82);
  });

  test("rejects malformed schema output", () => {
    expect(() => OllamaFashionResultSchema.parse({ category: "outerwear" })).toThrow();
  });

  test("retries once after malformed JSON", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonResponse({
        message: { content: calls === 1 ? "not json" : JSON.stringify(validFashionResult) },
      });
    };

    const result = await analyzeFashionWithOllama("abc123", {
      baseUrl: "test-endpoint",
      fetchImpl,
      timeoutMs: 100,
    });

    expect(calls).toBe(2);
    expect(result.category).toBe("outerwear");
  });

  test("reports Ollama offline", async () => {
    const fetchImpl = async () => {
      throw new Error("fetch failed ECONNREFUSED");
    };

    const health = await checkOllamaHealth({
      baseUrl: "test-endpoint",
      fetchImpl,
      timeoutMs: 100,
    });

    expect(health.status).toBe("ollama_not_running");
  });

  test("reports model missing", async () => {
    const fetchImpl = async () =>
      jsonResponse({ models: [{ name: "llava:latest", details: { families: ["vision"] } }] });

    const health = await checkOllamaHealth({
      baseUrl: "test-endpoint",
      fetchImpl,
      model: "gemma3",
      timeoutMs: 100,
    });

    expect(health.status).toBe("model_not_installed");
  });

  test("reports timeout errors with a public code", async () => {
    const response = mapOllamaError(new DOMException("Aborted", "AbortError"));

    expect(await responseErrorCode(response)).toBe("OLLAMA_TIMEOUT");
  });

  test("rejects unsupported image types", () => {
    expect(() => parseDataUrlImage("data:image/gif;base64,AAAA")).toThrow("Unsupported image type");
  });

  test("rejects oversized images", () => {
    const oversizedBase64 = "A".repeat(Math.ceil((MAX_IMAGE_BYTES + 1) * 1.34));

    expect(() => parseDataUrlImage(`data:image/png;base64,${oversizedBase64}`)).toThrow(
      "Image is too large",
    );
  });

  test("allows low-confidence no-fashion output to be detected by callers", () => {
    const result = parseOllamaFashionContent(
      JSON.stringify({ ...validFashionResult, category: null, confidence: 0.08 }),
    );

    expect(result.category).toBeNull();
    expect(result.confidence).toBeLessThan(0.18);
  });
});
