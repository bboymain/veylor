import { createHash } from "node:crypto";
import { FashionScanResultSchema, type FashionScanResult } from "./fashion-scan";
import type { ParsedDataUrlImage } from "./image-data";

type ServerEnv = Record<string, string | undefined>;

type SupabaseConfig = {
  url: string;
  serviceRoleKey: string;
};

function serverEnv(): ServerEnv {
  return typeof process === "undefined" ? {} : process.env;
}

function supabaseConfig(): SupabaseConfig | null {
  const env = serverEnv();
  const url = env.SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) return null;
  return { url: url.replace(/\/+$/, ""), serviceRoleKey };
}

function headers(config: SupabaseConfig, prefer = "return=representation"): HeadersInit {
  return {
    apikey: config.serviceRoleKey,
    authorization: `Bearer ${config.serviceRoleKey}`,
    "content-type": "application/json",
    prefer,
  };
}

export function fingerprintImage(image: ParsedDataUrlImage): string {
  return createHash("sha256").update(Buffer.from(image.base64, "base64")).digest("hex");
}

export type VerifiedScanCacheHit = {
  sourceSearchId: string;
  sourceModel: string;
  result: FashionScanResult;
};

type SearchRow = {
  id?: unknown;
  model?: unknown;
  summary?: unknown;
  detected_items?: unknown;
};

export function parseVerifiedScanCacheRow(row: SearchRow): VerifiedScanCacheHit | null {
  if (typeof row.id !== "string" || typeof row.model !== "string") return null;
  const parsed = FashionScanResultSchema.safeParse({
    summary: row.summary,
    items: row.detected_items,
  });
  if (!parsed.success || parsed.data.items.length === 0) return null;
  return { sourceSearchId: row.id, sourceModel: row.model, result: parsed.data };
}

export async function findVerifiedScanCacheHit(
  imageSha256: string,
): Promise<VerifiedScanCacheHit | null> {
  const config = supabaseConfig();
  if (!config) return null;

  const params = new URLSearchParams({
    select: "id,model,summary,detected_items",
    search_type: "eq.scan",
    status: "eq.success",
    cache_status: "eq.verified",
    image_sha256: `eq.${imageSha256}`,
    order: "cache_verified_at.desc.nullslast,created_at.desc",
    limit: "1",
  });

  try {
    const response = await fetch(`${config.url}/rest/v1/searches?${params.toString()}`, {
      headers: headers(config),
    });
    if (!response.ok) {
      console.error(`[scan-cache] Lookup failed (status ${response.status}).`);
      return null;
    }
    const rows = (await response.json()) as SearchRow[];
    return rows[0] ? parseVerifiedScanCacheRow(rows[0]) : null;
  } catch (error) {
    console.error("[scan-cache] Lookup failed.", error);
    return null;
  }
}

export async function markVerifiedScanCacheHit(sourceSearchId: string): Promise<void> {
  const config = supabaseConfig();
  if (!config) return;
  try {
    await fetch(`${config.url}/rest/v1/searches?id=eq.${encodeURIComponent(sourceSearchId)}`, {
      method: "PATCH",
      headers: headers(config, "return=minimal"),
      body: JSON.stringify({ last_cache_hit_at: new Date().toISOString() }),
    });
  } catch (error) {
    console.error("[scan-cache] Failed to record cache hit.", error);
  }
}
