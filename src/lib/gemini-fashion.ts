import { createPartFromBase64, GoogleGenAI, Type, type Schema } from "@google/genai";
import { z } from "zod";
import { FashionScanResultSchema, type FashionScanResult } from "@/lib/fashion-scan";
import type { ParsedDataUrlImage } from "@/lib/image-data";
import { jsonResponse } from "@/lib/ollama-fashion";

export const GEMINI_MODEL = "gemini-2.5-flash";
export const GEMINI_TIMEOUT_MS = 45_000;

export type GeminiProviderConfig = {
  apiKey?: string;
  timeoutMs?: number;
};

const nullableString = (description: string): Schema => ({
  type: Type.STRING,
  nullable: true,
  description,
});

const stringArray = (description: string): Schema => ({
  type: Type.ARRAY,
  description,
  minItems: "1",
  items: { type: Type.STRING },
});

export const GEMINI_FASHION_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["summary", "items"],
  propertyOrdering: ["summary", "items"],
  properties: {
    summary: {
      type: Type.STRING,
      description: "One concise sentence summarizing every visible fashion item.",
    },
    items: {
      type: Type.ARRAY,
      description: "Every visible clothing, footwear, bag, watch, jewelry, hat, or accessory item.",
      items: {
        type: Type.OBJECT,
        required: [
          "id",
          "category",
          "name",
          "color",
          "material",
          "style",
          "pattern",
          "visibleBrand",
          "brandConfidence",
          "confidence",
          "searchQueries",
          "affordableAlternativeQueries",
          "premiumAlternativeQueries",
        ],
        propertyOrdering: [
          "id",
          "category",
          "name",
          "color",
          "material",
          "style",
          "pattern",
          "visibleBrand",
          "brandConfidence",
          "confidence",
          "searchQueries",
          "affordableAlternativeQueries",
          "premiumAlternativeQueries",
        ],
        properties: {
          id: { type: Type.STRING, description: "Stable id such as item-1, item-2." },
          category: {
            type: Type.STRING,
            description: "Broad item type such as top, jacket, pants, shoes, bag, watch, jewelry.",
          },
          name: { type: Type.STRING, description: "Retailer-friendly item name." },
          color: { type: Type.STRING, description: "Primary visible color." },
          material: nullableString("Likely material, or null when uncertain."),
          style: { type: Type.STRING, description: "Style family or aesthetic." },
          pattern: nullableString("Visible pattern, or null when plain or uncertain."),
          visibleBrand: nullableString(
            "Brand only when visible logo, label, or highly distinctive detail supports it.",
          ),
          brandConfidence: {
            type: Type.NUMBER,
            minimum: 0,
            maximum: 1,
            description: "Confidence in the visibleBrand value from 0 to 1.",
          },
          confidence: {
            type: Type.NUMBER,
            minimum: 0,
            maximum: 1,
            description: "Overall item attribute confidence from 0 to 1.",
          },
          searchQueries: stringArray("Useful shopping search queries for this item."),
          affordableAlternativeQueries: stringArray("Budget-friendly alternative search queries."),
          premiumAlternativeQueries: stringArray("Premium or designer alternative search queries."),
        },
      },
    },
  },
};

export const GEMINI_FASHION_PROMPT = `Analyze every visible fashion item in this image.
Include tops, jackets, pants, dresses, shoes, bags, watches, jewelry, hats, and other accessories.
Return JSON only. Do not wrap the JSON in markdown.
Do not describe the person, face, body, pose, or background except as needed to identify fashion items.
Do not claim an exact brand unless a visible logo, label, readable text, or highly distinctive detail supports it.
Use null when material, pattern, or brand cannot be determined.
Keep confidence and brandConfidence values between 0 and 1.
Generate useful shopping search queries for each item.
Generate affordable and premium alternative queries for each item.`;

function publicGeminiError(message: string, status = 500, code = "GEMINI_ERROR") {
  return jsonResponse({ error: { code, message } }, status);
}

function errorStatus(error: unknown) {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

export function parseGeminiFashionContent(content: string): FashionScanResult {
  const trimmed = content.trim();
  const jsonText =
    trimmed.startsWith("{") && trimmed.endsWith("}")
      ? trimmed
      : (trimmed.match(/\{[\s\S]*\}/)?.[0] ?? "");

  if (!jsonText) throw new Error("Empty Gemini response.");
  return FashionScanResultSchema.parse(JSON.parse(jsonText));
}

export function mapGeminiError(error: unknown) {
  const message = errorMessage(error);
  const lower = message.toLowerCase();
  const status = errorStatus(error);

  if (lower.includes("unsupported image") || lower.includes("too large")) {
    return publicGeminiError(message, 400, "INVALID_IMAGE");
  }
  if (lower.includes("missing") && lower.includes("api key")) {
    return publicGeminiError(
      "Missing Gemini API key. Add GEMINI_API_KEY to .dev.vars.",
      500,
      "GEMINI_API_KEY_MISSING",
    );
  }
  if (lower.includes("abort") || lower.includes("timeout")) {
    return publicGeminiError(
      "The Gemini request timed out. Try a smaller crop or image.",
      504,
      "GEMINI_TIMEOUT",
    );
  }
  if (
    status === 401 ||
    status === 403 ||
    lower.includes("api key") ||
    lower.includes("api_key") ||
    lower.includes("credential")
  ) {
    return publicGeminiError(
      "Gemini rejected the API key. Check GEMINI_API_KEY.",
      401,
      "GEMINI_AUTH_FAILED",
    );
  }
  if (status === 429 || lower.includes("rate limit") || lower.includes("quota")) {
    return publicGeminiError(
      "Gemini rate limit reached. Wait and try again.",
      429,
      "GEMINI_RATE_LIMIT",
    );
  }
  if (lower.includes("empty") || lower.includes("invalid") || error instanceof z.ZodError) {
    return publicGeminiError(
      "Invalid Gemini response. Try again or use manual entry.",
      502,
      "INVALID_GEMINI_RESPONSE",
    );
  }

  return publicGeminiError(
    "Gemini could not analyze the image. Try again or use manual entry.",
    502,
    "GEMINI_ERROR",
  );
}

export async function analyzeFashionWithGemini(
  image: ParsedDataUrlImage,
  config: GeminiProviderConfig,
): Promise<FashionScanResult> {
  if (!config.apiKey?.trim()) {
    throw new Error("Missing Gemini API key.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? GEMINI_TIMEOUT_MS);

  try {
    const ai = new GoogleGenAI({ apiKey: config.apiKey });
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [GEMINI_FASHION_PROMPT, createPartFromBase64(image.base64, image.mimeType)],
      config: {
        abortSignal: controller.signal,
        responseMimeType: "application/json",
        responseSchema: GEMINI_FASHION_RESPONSE_SCHEMA,
        temperature: 0.2,
        maxOutputTokens: 4096,
      },
    });

    const text = response.text;
    if (!text) throw new Error("Empty Gemini response.");
    return parseGeminiFashionContent(text);
  } finally {
    clearTimeout(timeout);
  }
}
