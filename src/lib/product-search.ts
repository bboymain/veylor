import type { FashionScanItem } from "./fashion-scan";

export const PRODUCT_TIERS = ["authentic", "premium", "budget"] as const;

export type ProductTier = (typeof PRODUCT_TIERS)[number];

export type ProductSearchResult = {
  id: string;
  title: string;
  imageUrl: string;
  productUrl: string;
  price: number;
  currency: string;
  retailer: string;
  source: string;
  tier: ProductTier;
};

export type ProductSearchInput = {
  item: FashionScanItem;
  searchQueries: string[];
};

// `searchId` is only present for manual searches, which are logged by the
// product-search route itself; scan-based searches get their searchId from
// /api/fashion-scan and omit it here.
export type ProductSearchResponse =
  | { products: ProductSearchResult[]; searchId?: string | null }
  | { error: { code: "PRODUCT_SEARCH_FAILED"; message: string }; searchId?: string | null };

export function groupProductsByTier(products: ProductSearchResult[]) {
  return products.reduce<Record<ProductTier, ProductSearchResult[]>>(
    (groups, product) => {
      groups[product.tier].push(product);
      return groups;
    },
    { authentic: [], premium: [], budget: [] },
  );
}
