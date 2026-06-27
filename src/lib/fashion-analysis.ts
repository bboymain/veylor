export type AttributeGroup =
  | "category"
  | "color"
  | "secondaryColor"
  | "pattern"
  | "style"
  | "fit"
  | "silhouette"
  | "sleeve"
  | "neckline"
  | "material"
  | "shoeType"
  | "accessoryType"
  | "occasion";

export type AttributeResult = {
  label: string;
  confidence: number;
};

export type FashionAttributes = Record<AttributeGroup, AttributeResult>;

export type SearchQueries = {
  broad: string;
  balanced: string;
  detailed: string;
};

export type RetailerLink = {
  name: string;
  url: string;
};

export type ScanHistoryItem = {
  id: string;
  thumbnail: string;
  category: string;
  attributes: FashionAttributes;
  queries: SearchQueries;
  scannedAt: string;
};

export const FASHION_LABEL_GROUPS: Record<AttributeGroup, string[]> = {
  category: [
    "T-shirt",
    "button-up shirt",
    "blouse",
    "hoodie",
    "sweatshirt",
    "bomber jacket",
    "leather jacket",
    "denim jacket",
    "blazer",
    "coat",
    "dress",
    "skirt",
    "jeans",
    "trousers",
    "shorts",
    "sneakers",
    "boots",
    "heels",
    "sandals",
    "handbag",
    "backpack",
    "sunglasses",
    "hat",
    "watch",
    "jewelry",
  ],
  color: [
    "black",
    "white",
    "cream",
    "gray",
    "navy",
    "blue",
    "light blue",
    "brown",
    "tan",
    "beige",
    "green",
    "red",
    "pink",
    "purple",
    "yellow",
    "orange",
    "silver",
    "gold",
  ],
  secondaryColor: [
    "black",
    "white",
    "cream",
    "gray",
    "navy",
    "blue",
    "brown",
    "tan",
    "beige",
    "green",
    "red",
    "pink",
    "metallic",
    "none visible",
  ],
  pattern: [
    "solid",
    "striped",
    "plaid",
    "checkered",
    "floral",
    "animal print",
    "polka dot",
    "graphic print",
    "logo pattern",
    "text print",
    "color block",
    "distressed",
  ],
  style: [
    "minimal",
    "streetwear",
    "classic",
    "preppy",
    "athleisure",
    "formal",
    "bohemian",
    "vintage",
    "luxury",
    "workwear",
    "romantic",
    "edgy",
  ],
  fit: ["slim fit", "regular fit", "relaxed fit", "oversized", "tailored", "cropped"],
  silhouette: [
    "straight silhouette",
    "boxy silhouette",
    "A-line silhouette",
    "fitted silhouette",
    "wide-leg silhouette",
    "tapered silhouette",
    "flowy silhouette",
    "structured silhouette",
  ],
  sleeve: [
    "sleeveless",
    "short sleeve",
    "three-quarter sleeve",
    "long sleeve",
    "cap sleeve",
    "strapless",
    "not applicable",
  ],
  neckline: [
    "crew neck",
    "V-neck",
    "collared",
    "turtleneck",
    "scoop neck",
    "square neck",
    "strapless",
    "hooded",
    "not visible",
  ],
  material: [
    "cotton",
    "denim",
    "leather",
    "faux leather",
    "wool",
    "knit",
    "silk",
    "satin",
    "linen",
    "nylon",
    "polyester",
    "canvas",
    "suede",
    "metal",
  ],
  shoeType: ["sneakers", "boots", "heels", "sandals", "loafers", "flats", "not a shoe"],
  accessoryType: [
    "handbag",
    "backpack",
    "sunglasses",
    "hat",
    "watch",
    "jewelry",
    "belt",
    "scarf",
    "not an accessory",
  ],
  occasion: ["casual", "work", "evening", "formal", "party", "travel", "athletic", "everyday"],
};

const ATTRIBUTE_LABELS: Record<AttributeGroup, string> = {
  category: "Category",
  color: "Primary color",
  secondaryColor: "Secondary color",
  pattern: "Pattern",
  style: "Style",
  fit: "Fit",
  silhouette: "Silhouette",
  sleeve: "Sleeve length",
  neckline: "Neckline",
  material: "Likely material",
  shoeType: "Shoe type",
  accessoryType: "Accessory type",
  occasion: "Occasion",
};

export const EDITABLE_ATTRIBUTE_GROUPS = Object.keys(FASHION_LABEL_GROUPS) as AttributeGroup[];

export function getAttributeLabel(group: AttributeGroup) {
  return ATTRIBUTE_LABELS[group];
}

export function makeEmptyAttributes(): FashionAttributes {
  return EDITABLE_ATTRIBUTE_GROUPS.reduce((acc, group) => {
    acc[group] = { label: "", confidence: 0 };
    return acc;
  }, {} as FashionAttributes);
}

function confident(value: AttributeResult | undefined, minimum = 18) {
  if (!value || !value.label || value.confidence < minimum) return "";
  if (value.label.startsWith("not ") || value.label === "none visible") return "";
  return value.label;
}

function uniqueWords(parts: string[]) {
  return Array.from(new Set(parts.filter(Boolean)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildSearchQueries(
  attributes: FashionAttributes,
  visibleText = "",
  possibleBrand = "",
) {
  const category = confident(attributes.category, 12) || "fashion item";
  const color = confident(attributes.color);
  const fit = confident(attributes.fit);
  const material = confident(attributes.material);
  const style = confident(attributes.style);
  const pattern = confident(attributes.pattern);
  const neckline = confident(attributes.neckline);
  const sleeve = confident(attributes.sleeve);
  const occasion = confident(attributes.occasion);
  const safeBrand = possibleBrand.trim();

  return {
    broad: uniqueWords([color, category]),
    balanced: uniqueWords([color, fit, material, pattern !== "solid" ? pattern : "", category]),
    detailed: uniqueWords([
      safeBrand,
      occasion,
      color,
      fit,
      sleeve,
      neckline,
      material,
      style,
      category,
    ]),
  };
}

export function buildRetailerLinks(query: string): RetailerLink[] {
  const encoded = encodeURIComponent(query);
  return [
    { name: "Google Shopping", url: `https://www.google.com/search?tbm=shop&q=${encoded}` },
    { name: "Walmart", url: `https://www.walmart.com/search?q=${encoded}` },
    { name: "Amazon", url: `https://www.amazon.com/s?k=${encoded}` },
    { name: "eBay", url: `https://www.ebay.com/sch/i.html?_nkw=${encoded}` },
    { name: "Target", url: `https://www.target.com/s?searchTerm=${encoded}` },
    { name: "ASOS", url: `https://www.asos.com/us/search/?q=${encoded}` },
  ];
}

export function confidenceLabel(score: number) {
  if (score >= 0.5) return "high";
  if (score >= 0.25) return "medium";
  return "low";
}
