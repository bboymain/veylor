import { z } from "zod";

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

export type FashionScanResponse =
  | {
      result: FashionScanResult;
      image: { mimeType: string; byteLength: number };
      searchId?: string | null;
      cache?: { hit: boolean };
    }
  | { error: { code: string; message: string }; searchId?: string | null };

export function jsonResponse(payload: unknown, status = 200) {
  return Response.json(payload, { status });
}
