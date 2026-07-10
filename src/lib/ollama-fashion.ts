import { z } from "zod";
import { MAX_IMAGE_BYTES, parseDataUrlImage, SUPPORTED_IMAGE_MIME_TYPES } from "@/lib/image-data";
import { jsonResponse } from "@/lib/fashion-scan";

export const OLLAMA_DEFAULT_MODEL = "qwen2.5vl";
export const OLLAMA_TIMEOUT_MS = 45_000;
export { MAX_IMAGE_BYTES, parseDataUrlImage, SUPPORTED_IMAGE_MIME_TYPES };

export const OllamaFashionResultSchema = z.object({
  category: z.string().nullable(),
  subcategory: z.string().nullable(),
  itemName: z.string().nullable(),
  primaryColor: z.string().nullable(),
  secondaryColors: z.array(z.string()),
  pattern: z.string().nullable(),
  likelyMaterial: z.string().nullable(),
  style: z.array(z.string()),
  fit: z.string().nullable(),
  silhouette: z.string().nullable(),
  sleeveLength: z.string().nullable(),
  neckline: z.string().nullable(),
  shoeType: z.string().nullable(),
  accessoryType: z.string().nullable(),
  visibleText: z.string().nullable(),
  possibleBrand: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  searchKeywords: z.array(z.string()),
  warnings: z.array(z.string()),
});

export type OllamaFashionResult = z.infer<typeof OllamaFashionResultSchema>;

export type OllamaHealthStatus =
  | "ollama_connected"
  | "ollama_not_running"
  | "model_not_installed"
  | "invalid_ollama_response";

export type OllamaHealthResult = {
  status: OllamaHealthStatus;
  model: string;
  message: string;
};

export type OllamaProviderConfig = {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
};

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type OllamaModelListResponse = {
  models?: Array<{
    name?: string;
    model?: string;
    details?: { families?: string[]; family?: string };
  }>;
};

type OllamaChatResponse = {
  message?: { content?: string };
  response?: string;
};

export function getOllamaConfig(env: Record<string, string | undefined> = {}) {
  const baseUrl = env.OLLAMA_BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error("OLLAMA_BASE_URL is required for the standalone local provider.");
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    model: env.OLLAMA_VISION_MODEL || OLLAMA_DEFAULT_MODEL,
  };
}

export function publicOllamaError(message: string, status = 500, code = "OLLAMA_ERROR") {
  return jsonResponse({ error: { code, message } }, status);
}

export const OLLAMA_FASHION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    category: { anyOf: [{ type: "string" }, { type: "null" }] },
    subcategory: { anyOf: [{ type: "string" }, { type: "null" }] },
    itemName: { anyOf: [{ type: "string" }, { type: "null" }] },
    primaryColor: { anyOf: [{ type: "string" }, { type: "null" }] },
    secondaryColors: { type: "array", items: { type: "string" } },
    pattern: { anyOf: [{ type: "string" }, { type: "null" }] },
    likelyMaterial: { anyOf: [{ type: "string" }, { type: "null" }] },
    style: { type: "array", items: { type: "string" } },
    fit: { anyOf: [{ type: "string" }, { type: "null" }] },
    silhouette: { anyOf: [{ type: "string" }, { type: "null" }] },
    sleeveLength: { anyOf: [{ type: "string" }, { type: "null" }] },
    neckline: { anyOf: [{ type: "string" }, { type: "null" }] },
    shoeType: { anyOf: [{ type: "string" }, { type: "null" }] },
    accessoryType: { anyOf: [{ type: "string" }, { type: "null" }] },
    visibleText: { anyOf: [{ type: "string" }, { type: "null" }] },
    possibleBrand: { anyOf: [{ type: "string" }, { type: "null" }] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    searchKeywords: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: [
    "category",
    "subcategory",
    "itemName",
    "primaryColor",
    "secondaryColors",
    "pattern",
    "likelyMaterial",
    "style",
    "fit",
    "silhouette",
    "sleeveLength",
    "neckline",
    "shoeType",
    "accessoryType",
    "visibleText",
    "possibleBrand",
    "confidence",
    "searchKeywords",
    "warnings",
  ],
};

export const FASHION_ANALYSIS_PROMPT = `Analyze only the selected fashion item in this image.
Return JSON only. Do not describe the person, body, face, setting, or background.
Focus only on clothing, footwear, or accessories.
Avoid inventing a brand. Use possibleBrand only when visible text or a clear logo supports it.
Return null for uncertain fields. Separate visible facts from guesses using warnings.
Confidence must be a number from 0 to 1.
searchKeywords must contain useful retailer search phrases without unsupported brands.`;

function extractContent(response: OllamaChatResponse) {
  return response.message?.content ?? response.response ?? "";
}

export function parseOllamaFashionContent(content: string) {
  const trimmed = content.trim();
  const jsonText =
    trimmed.startsWith("{") && trimmed.endsWith("}")
      ? trimmed
      : (trimmed.match(/\{[\s\S]*\}/)?.[0] ?? "");

  if (!jsonText) throw new Error("Invalid Ollama response.");
  return OllamaFashionResultSchema.parse(JSON.parse(jsonText));
}

export function mapOllamaError(error: unknown, model = OLLAMA_DEFAULT_MODEL) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes("abort") || lower.includes("timeout")) {
    return publicOllamaError(
      "The local Ollama request timed out. Try a smaller crop or a lighter model.",
      504,
      "OLLAMA_TIMEOUT",
    );
  }
  if (
    lower.includes("fetch failed") ||
    lower.includes("econnrefused") ||
    lower.includes("connection refused")
  ) {
    return publicOllamaError(
      "Ollama is not running. Start Ollama and try again.",
      503,
      "OLLAMA_OFFLINE",
    );
  }
  if (lower.includes("model") && (lower.includes("not found") || lower.includes("missing"))) {
    return publicOllamaError(
      `The configured model is missing. Run: ollama pull ${model}`,
      404,
      "MODEL_MISSING",
    );
  }
  if (lower.includes("memory") || lower.includes("out of memory")) {
    return publicOllamaError(
      "The model ran out of memory. Try a smaller image or a lighter vision model.",
      507,
      "OLLAMA_OOM",
    );
  }
  if (lower.includes("unsupported image") || lower.includes("too large")) {
    return publicOllamaError(message, 400, "INVALID_IMAGE");
  }

  return publicOllamaError(
    "Invalid Ollama response. Try again or use manual entry.",
    502,
    "INVALID_OLLAMA_RESPONSE",
  );
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: FetchLike,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkOllamaHealth(
  config: OllamaProviderConfig = {},
): Promise<OllamaHealthResult> {
  const { baseUrl, model } = getOllamaConfig({
    OLLAMA_BASE_URL: config.baseUrl,
    OLLAMA_VISION_MODEL: config.model,
  });
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 4_000;

  try {
    const tagsResponse = await fetchWithTimeout(`${baseUrl}/api/tags`, {}, timeoutMs, fetchImpl);
    if (!tagsResponse.ok) throw new Error("Invalid Ollama response.");
    const tags = (await tagsResponse.json()) as OllamaModelListResponse;
    if (!Array.isArray(tags.models)) throw new Error("Invalid Ollama response.");

    const configuredModel = tags.models.find((entry) => {
      const name = entry.name ?? entry.model ?? "";
      return name === model || name === `${model}:latest` || name.startsWith(`${model}:`);
    });

    if (!configuredModel) {
      return {
        status: "model_not_installed",
        model,
        message: `The configured model is missing. Run: ollama pull ${model}`,
      };
    }

    const families = [
      ...(configuredModel.details?.families ?? []),
      configuredModel.details?.family ?? "",
      configuredModel.name ?? "",
      configuredModel.model ?? "",
    ]
      .join(" ")
      .toLowerCase();

    if (!/(vision|clip|llava|bakllava|moondream|gemma3|qwen.*vl)/.test(families)) {
      return {
        status: "invalid_ollama_response",
        model,
        message: "The configured model does not appear to advertise image support.",
      };
    }

    return { status: "ollama_connected", model, message: "Ollama connected" };
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (
      message.includes("fetch failed") ||
      message.includes("abort") ||
      message.includes("connection")
    ) {
      return {
        status: "ollama_not_running",
        model,
        message: "Ollama is not running. Start Ollama and try again.",
      };
    }

    return { status: "invalid_ollama_response", model, message: "Invalid Ollama response" };
  }
}

export async function analyzeFashionWithOllama(
  imageBase64: string,
  config: OllamaProviderConfig = {},
) {
  const { baseUrl, model } = getOllamaConfig({
    OLLAMA_BASE_URL: config.baseUrl,
    OLLAMA_VISION_MODEL: config.model,
  });
  const fetchImpl = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? OLLAMA_TIMEOUT_MS;

  async function callOllama(prompt: string) {
    const response = await fetchWithTimeout(
      `${baseUrl}/api/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          format: OLLAMA_FASHION_JSON_SCHEMA,
          messages: [{ role: "user", content: prompt, images: [imageBase64] }],
        }),
      },
      timeoutMs,
      fetchImpl,
    );

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return extractContent((await response.json()) as OllamaChatResponse);
  }

  try {
    return parseOllamaFashionContent(await callOllama(FASHION_ANALYSIS_PROMPT));
  } catch {
    return parseOllamaFashionContent(
      await callOllama(
        `${FASHION_ANALYSIS_PROMPT}\nYour previous response was invalid. Return valid JSON only matching the schema.`,
      ),
    );
  }
}
