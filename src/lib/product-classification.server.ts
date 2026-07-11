// Server-only deterministic brand/product classification.
//
// This module contains no I/O and reads no environment variables; it applies
// documented, deterministic rules to already-fetched data. It must never be
// imported from client code (classification reasons and brand evidence are
// server-side concerns until a later phase exposes them deliberately).
//
// Core principles:
//   * Authenticity is evidence-based. A product is never marked authentic
//     because of its price, its title alone, or its market tier.
//   * Unknown evidence stays "unknown". "suspicious" is reserved for future
//     deterministic negative evidence; no current rule emits it.
//   * Brand association requires an exact normalized match between the
//     detected brand name and a known brands row (normalized_name or alias),
//     plus the brand being evident in the product title. Brand records are
//     never invented from weak guesses.

export const MARKET_TIERS = ["luxury", "premium", "mid_market", "budget", "unknown"] as const;
export type MarketTier = (typeof MARKET_TIERS)[number];

export const AUTHENTICITY_STATUSES = ["verified", "likely", "unknown", "suspicious"] as const;
export type AuthenticityStatus = (typeof AUTHENTICITY_STATUSES)[number];

export const VERIFICATION_STATUSES = ["verified", "unverified", "unknown"] as const;
export type BrandVerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** A brands table row, as loaded server-side. Aliases are stored normalized. */
export type BrandRecord = {
  id: string;
  normalizedName: string;
  aliases: string[];
  marketTier: MarketTier;
  verificationStatus: BrandVerificationStatus;
  officialDomains: string[];
  trustedRetailers: string[];
};

/**
 * Canonical brand-name form used for matching and for brands.normalized_name:
 * Unicode-decomposed, lowercased, diacritics and all non-alphanumerics
 * removed. Examples: "Levi's" → "levis", "H&M" → "hm", "Comme des Garçons" →
 * "commedesgarcons".
 */
export function normalizeBrandName(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Lowercased, whitespace-collapsed title for products.normalized_title. */
export function normalizeProductTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Registrable-ish domain from a product URL: lowercased host, no "www.". */
export function retailerDomainFromUrl(productUrl: string): string | null {
  try {
    const host = new URL(productUrl).hostname.toLowerCase();
    const domain = host.startsWith("www.") ? host.slice(4) : host;
    return domain || null;
  } catch {
    return null;
  }
}

/** True when the candidate (already normalized) names this brand exactly. */
export function brandMatches(brand: BrandRecord, normalizedCandidate: string): boolean {
  if (!normalizedCandidate) return false;
  if (brand.normalizedName === normalizedCandidate) return true;
  return brand.aliases.some((alias) => normalizeBrandName(alias) === normalizedCandidate);
}

function domainMatches(domain: string, candidate: string): boolean {
  const normalized = candidate.toLowerCase().trim();
  if (!normalized) return false;
  return domain === normalized || domain.endsWith(`.${normalized}`);
}

function isTrustedRetailer(
  brand: BrandRecord,
  retailer: string | null,
  domain: string | null,
): boolean {
  return brand.trustedRetailers.some((entry) => {
    const trimmed = entry.trim();
    if (!trimmed) return false;
    // Entries containing a dot are treated as domains; others as retailer names.
    if (trimmed.includes(".")) {
      return domain !== null && domainMatches(domain, trimmed);
    }
    return retailer !== null && normalizeBrandName(retailer) === normalizeBrandName(trimmed);
  });
}

export type ClassificationInput = {
  title: string;
  /** Brand name reported by the scan/user, if any. Never inferred from title. */
  detectedBrandName: string | null;
  retailer: string | null;
  retailerDomain: string | null;
  price: number | null;
  productUrl: string;
  /** Matching brands row, when the caller found one. */
  brand: BrandRecord | null;
};

export type ClassificationResult = {
  brandId: string | null;
  marketTier: MarketTier;
  authenticityStatus: AuthenticityStatus;
  /** 0..1; fixed per rule so classification is deterministic. */
  confidence: number;
  /** Short, storage-safe explanation. Never contains URLs or secrets. */
  reason: string;
};

const UNKNOWN: Omit<ClassificationResult, "reason"> = {
  brandId: null,
  marketTier: "unknown",
  authenticityStatus: "unknown",
  confidence: 0,
};

/**
 * Deterministic classification rules, applied in order:
 *
 * 1. No brands row, no detected brand name, or no exact normalized/alias
 *    match → everything stays unknown.
 * 2. Brand must also be evident in the product title (normalized substring);
 *    otherwise the result is likely a different-brand alternative and stays
 *    unknown. Title evidence alone never *raises* authenticity — it only
 *    gates brand association.
 * 3. Associated products take the brand's market_tier.
 * 4. Authenticity evidence, strongest first:
 *      official brand domain + verified brand record → verified (0.95)
 *      official brand domain + unverified record     → likely   (0.75)
 *      trusted retailer/domain for this brand        → likely   (0.8)
 *      no retailer evidence                          → unknown  (0.6)
 *
 * Price is intentionally never consulted. Expensive counterfeits exist.
 */
export function classifyProduct(input: ClassificationInput): ClassificationResult {
  const detected = normalizeBrandName(input.detectedBrandName ?? "");
  if (!input.brand || !detected || !brandMatches(input.brand, detected)) {
    return { ...UNKNOWN, reason: "No deterministic brand match." };
  }

  const brand = input.brand;
  const normalizedTitle = normalizeBrandName(input.title);
  const brandTokens = [brand.normalizedName, ...brand.aliases.map(normalizeBrandName)];
  if (!brandTokens.some((token) => token.length > 0 && normalizedTitle.includes(token))) {
    return { ...UNKNOWN, reason: "Brand not evident in product title." };
  }

  const domain = input.retailerDomain?.toLowerCase().trim() || null;
  const officialDomain =
    domain !== null && brand.officialDomains.some((official) => domainMatches(domain, official));

  if (officialDomain && brand.verificationStatus === "verified") {
    return {
      brandId: brand.id,
      marketTier: brand.marketTier,
      authenticityStatus: "verified",
      confidence: 0.95,
      reason: "Sold via official brand domain.",
    };
  }
  if (officialDomain) {
    return {
      brandId: brand.id,
      marketTier: brand.marketTier,
      authenticityStatus: "likely",
      confidence: 0.75,
      reason: "Official domain match on unverified brand record.",
    };
  }
  if (isTrustedRetailer(brand, input.retailer, domain)) {
    return {
      brandId: brand.id,
      marketTier: brand.marketTier,
      authenticityStatus: "likely",
      confidence: 0.8,
      reason: "Sold via trusted retailer for this brand.",
    };
  }
  return {
    brandId: brand.id,
    marketTier: brand.marketTier,
    authenticityStatus: "unknown",
    confidence: 0.6,
    reason: "Brand matched; no retailer evidence.",
  };
}
