import { normalizeProductUrl } from "./product-persistence.server";
import type { ProductSearchResult } from "./product-search";

type ServerEnv = Record<string, string | undefined>;
type SupabaseConfig = { url: string; serviceRoleKey: string };

const SHOPPER_COOKIE = "veylor_shopper";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function headers(config: SupabaseConfig): HeadersInit {
  return {
    apikey: config.serviceRoleKey,
    authorization: `Bearer ${config.serviceRoleKey}`,
    "content-type": "application/json",
    prefer: "return=representation",
  };
}

export type AnonymousShopper = {
  id: string;
  isNew: boolean;
};

export function resolveAnonymousShopper(request: Request): AnonymousShopper {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const existing = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SHOPPER_COOKIE}=`))
    ?.slice(SHOPPER_COOKIE.length + 1);

  if (existing && UUID_PATTERN.test(existing)) return { id: existing, isNew: false };
  return { id: crypto.randomUUID(), isNew: true };
}

export function attachAnonymousShopperCookie(response: Response, shopper: AnonymousShopper): Response {
  if (!shopper.isNew) return response;
  response.headers.append(
    "set-cookie",
    `${SHOPPER_COOKIE}=${shopper.id}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure`,
  );
  return response;
}

export type ShopperPreferences = {
  preferredRetailers: Record<string, number>;
  preferredTiers: Record<string, number>;
  averagePrice: number | null;
  clickCount: number;
};

type PreferenceRow = {
  preferred_retailers?: unknown;
  preferred_tiers?: unknown;
  average_price?: unknown;
  click_count?: unknown;
};

function numericRecord(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (typeof count === "number" && Number.isFinite(count) && count > 0) result[key] = count;
  }
  return result;
}

export function parseShopperPreferences(row: PreferenceRow | undefined): ShopperPreferences | null {
  if (!row) return null;
  const clickCount = typeof row.click_count === "number" && row.click_count >= 0 ? row.click_count : 0;
  return {
    preferredRetailers: numericRecord(row.preferred_retailers),
    preferredTiers: numericRecord(row.preferred_tiers),
    averagePrice:
      typeof row.average_price === "number" && Number.isFinite(row.average_price)
        ? row.average_price
        : null,
    clickCount,
  };
}

export async function loadShopperPreferences(profileId: string): Promise<ShopperPreferences | null> {
  const config = supabaseConfig();
  if (!config || !UUID_PATTERN.test(profileId)) return null;

  try {
    const response = await fetch(`${config.url}/rest/v1/rpc/get_shopper_preferences`, {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify({ p_profile_id: profileId }),
    });
    if (!response.ok) return null;
    const rows = (await response.json()) as PreferenceRow[];
    return parseShopperPreferences(rows[0]);
  } catch {
    return null;
  }
}

export async function recordShopperPreferenceClick(input: {
  profileId: string;
  searchId: string;
  productUrl: string;
}): Promise<boolean> {
  const config = supabaseConfig();
  const normalizedUrl = normalizeProductUrl(input.productUrl);
  if (!config || !normalizedUrl || !UUID_PATTERN.test(input.profileId)) return false;

  try {
    const response = await fetch(`${config.url}/rest/v1/rpc/record_shopper_preference_click`, {
      method: "POST",
      headers: headers(config),
      body: JSON.stringify({
        p_profile_id: input.profileId,
        p_search_id: input.searchId,
        p_normalized_product_url: normalizedUrl,
        p_clicked_at: new Date().toISOString(),
      }),
    });
    if (!response.ok) return false;
    const result = (await response.json()) as unknown;
    return result === true;
  } catch {
    return false;
  }
}

export function shopperPreferenceScore(
  product: ProductSearchResult,
  preferences: ShopperPreferences | null,
): number {
  if (!preferences || preferences.clickCount < 2) return 0;

  let score = 0;
  const retailerClicks = preferences.preferredRetailers[product.retailer] ?? 0;
  const tierClicks = preferences.preferredTiers[product.tier] ?? 0;
  score += Math.min(0.6, retailerClicks * 0.15);
  score += Math.min(0.4, tierClicks * 0.1);

  if (preferences.averagePrice !== null && product.price > 0) {
    const relativeDifference = Math.abs(product.price - preferences.averagePrice) /
      Math.max(preferences.averagePrice, 1);
    score += Math.max(-0.4, 0.3 - relativeDifference * 0.4);
  }

  return Math.max(-0.5, Math.min(1, score));
}
