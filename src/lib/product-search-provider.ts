import { z } from "zod";
import { FashionScanItemSchema } from "./fashion-scan";
import {
  type ProductSearchInput,
  type ProductSearchResponse,
  type ProductSearchResult,
  type ProductTier,
} from "./product-search";

export const ProductSearchInputSchema = z.object({
  item: FashionScanItemSchema,
  searchQueries: z.array(z.string().trim().min(1)).min(1),
});

export interface ProductSearchProvider {
  search(input: ProductSearchInput): Promise<ProductSearchResult[]>;
}

export type MockProductRecord = {
  key: string;
  name: string;
  image: string;
  url: string;
  priceCents: number;
  currencyCode: string;
  merchant: string;
  tier: ProductTier;
};

type MockProviderOptions = {
  records?: MockProductRecord[];
  error?: Error;
};

const MOCK_IMAGES = {
  clothing:
    "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=600&q=80",
  shoes:
    "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=600&q=80",
  bag: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=600&q=80",
  accessory:
    "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=600&q=80",
} as const;

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function mockImageForCategory(category: string) {
  if (/shoe|sneaker|boot|heel|sandal|loafer/i.test(category)) return MOCK_IMAGES.shoes;
  if (/bag|purse|backpack/i.test(category)) return MOCK_IMAGES.bag;
  if (/watch|jewelry|hat|belt|scarf|sunglasses|accessor/i.test(category)) {
    return MOCK_IMAGES.accessory;
  }
  return MOCK_IMAGES.clothing;
}

function buildMockRecords(input: ProductSearchInput): MockProductRecord[] {
  const { item } = input;
  const image = mockImageForCategory(item.category);
  const itemSlug = slug(`${item.id}-${item.name}`) || "fashion-item";
  const authenticTitle = item.visibleBrand
    ? `${item.visibleBrand} ${item.name}`
    : `${item.name} original style`;

  return [
    {
      key: `${itemSlug}-authentic`,
      name: authenticTitle,
      image,
      url: `https://example.com/veylor/products/${itemSlug}-authentic`,
      priceCents: 18500,
      currencyCode: "USD",
      merchant: "SSENSE",
      tier: "authentic",
    },
    {
      key: `${itemSlug}-premium`,
      name: `Premium ${item.color} ${item.category}`,
      image,
      url: `https://example.com/veylor/products/${itemSlug}-premium`,
      priceCents: 9800,
      currencyCode: "USD",
      merchant: "Nordstrom",
      tier: "premium",
    },
    {
      key: `${itemSlug}-budget`,
      name: `Everyday ${item.color} ${item.category}`,
      image,
      url: `https://example.com/veylor/products/${itemSlug}-budget`,
      priceCents: 3900,
      currencyCode: "USD",
      merchant: "ASOS",
      tier: "budget",
    },
  ];
}

export function normalizeMockProduct(record: MockProductRecord): ProductSearchResult {
  return {
    id: record.key,
    title: record.name.trim(),
    imageUrl: record.image,
    productUrl: record.url,
    price: record.priceCents / 100,
    currency: record.currencyCode.toUpperCase(),
    retailer: record.merchant.trim(),
    source: "mock",
    tier: record.tier,
  };
}

export function createMockProductSearchProvider(
  options: MockProviderOptions = {},
): ProductSearchProvider {
  return {
    async search(input) {
      if (options.error) throw options.error;
      const records = options.records ?? buildMockRecords(input);
      return records.map(normalizeMockProduct);
    },
  };
}

export async function executeProductSearch(
  provider: ProductSearchProvider,
  input: ProductSearchInput,
): Promise<ProductSearchResponse> {
  try {
    return { products: await provider.search(input) };
  } catch (error) {
    return {
      error: {
        code: "PRODUCT_SEARCH_FAILED",
        message: error instanceof Error ? error.message : "Product search failed.",
      },
    };
  }
}

export const mockProductSearchProvider = createMockProductSearchProvider();
