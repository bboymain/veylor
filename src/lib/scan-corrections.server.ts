export const SCAN_CORRECTION_FIELDS = [
  "name",
  "category",
  "color",
  "style",
  "material",
  "pattern",
  "visibleBrand",
] as const;

export type ScanCorrectionField = (typeof SCAN_CORRECTION_FIELDS)[number];

type ServerEnv = Record<string, string | undefined>;

function serverEnv(): ServerEnv {
  return typeof process === "undefined" ? {} : process.env;
}

function config(): { url: string; key: string } | null {
  const env = serverEnv();
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

export function normalizeCorrectionValue(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized.slice(0, 200) : null;
}

export function isNoopCorrection(previousValue: string | null, correctedValue: string | null): boolean {
  return normalizeCorrectionValue(previousValue) === normalizeCorrectionValue(correctedValue);
}

export async function recordScanCorrection(input: {
  searchId: string;
  itemId: string;
  fieldName: ScanCorrectionField;
  previousValue: string | null;
  correctedValue: string | null;
}): Promise<boolean> {
  const supabase = config();
  if (!supabase || isNoopCorrection(input.previousValue, input.correctedValue)) return false;

  try {
    const response = await fetch(`${supabase.url}/rest/v1/rpc/record_scan_correction`, {
      method: "POST",
      headers: {
        apikey: supabase.key,
        authorization: `Bearer ${supabase.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        p_search_id: input.searchId,
        p_item_id: input.itemId,
        p_field_name: input.fieldName,
        p_previous_value: normalizeCorrectionValue(input.previousValue),
        p_corrected_value: normalizeCorrectionValue(input.correctedValue),
        p_created_at: new Date().toISOString(),
      }),
    });
    if (!response.ok) return false;
    return (await response.json()) === true;
  } catch {
    return false;
  }
}
