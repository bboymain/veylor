import { z } from "zod";
import type { OllamaFashionResult } from "@/lib/ollama-fashion";

export const FashionScanItemSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  name: z.string().min(1),
  color: z.string().min(1),
  material: z.string().nullable(),
  style: z.string().min(1),
  pattern: z.string().nullable(),
  visibleBrand: z.string().nullable(),
  brandConfidence: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  searchQueries: z.array(z.string()).min(1),
  affordableAlternativeQueries: z.array(z.string()).min(1),
  premiumAlternativeQueries: z.array(z.string()).min(1),
});

export const FashionScanResultSchema = z.object({
  summary: z.string().min(1),
  items: z.array(FashionScanItemSchema),
});

export type FashionScanItem = z.infer<typeof FashionScanItemSchema>;
export type FashionScanResult = z.infer<typeof FashionScanResultSchema>;
export type AiProvider = "gemini" | "local";

export type FashionScanResponse =
  | {
      provider: AiProvider;
      result: FashionScanResult;
      image: { mimeType: string; byteLength: number };
    }
  | { error: { code: string; message: string } };

function compact(parts: Array<string | null | undefined>) {
  return parts
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getAiProvider(env: Record<string, string | undefined> = {}): AiProvider {
  return env.AI_PROVIDER === "local" ? "local" : "gemini";
}

export function ollamaResultToFashionScanResult(result: OllamaFashionResult): FashionScanResult {
  const category = result.subcategory ?? result.category ?? "fashion item";
  const color = result.primaryColor ?? "unknown color";
  const name = result.itemName ?? (compact([color, category]) || category);
  const style = result.style[0] ?? "casual";
  const brand = result.possibleBrand?.trim() || null;
  const baseQuery = compact([brand, color, result.fit, result.likelyMaterial, category]) || name;

  return {
    summary: `Detected ${name}.`,
    items: [
      {
        id: "item-1",
        category,
        name,
        color,
        material: result.likelyMaterial,
        style,
        pattern: result.pattern,
        visibleBrand: brand,
        brandConfidence: brand ? result.confidence : 0,
        confidence: result.confidence,
        searchQueries: result.searchKeywords.length > 0 ? result.searchKeywords : [baseQuery],
        affordableAlternativeQueries: [
          compact(["affordable", baseQuery]),
          compact(["budget", color, category]),
        ],
        premiumAlternativeQueries: [
          compact(["premium", baseQuery]),
          compact(["designer", color, category]),
        ],
      },
    ],
  };
}
