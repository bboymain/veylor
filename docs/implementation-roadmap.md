# Veylor Implementation Roadmap

## Product flow

```text
Upload fashion photo
-> AI identifies visible fashion items
-> standardized Veylor fashion data
-> real product search
-> ranked exact and similar products
-> save searches, clicks, and corrections
-> improve results over time
```

## Phase 1 - Clean and stabilize the Gemini prototype

Create one polished public flow:

```text
Upload Photo
-> Preview Image
-> Scan Outfit
-> Review Detected Items
-> Open Similar-Style Searches
```

Keep image cropping, structured scan parsing, generated retailer searches, and browser-local scan
history. Remove public local-AI controls and duplicate marketing/search sections. Production uses
the server-only `GEMINI_API_KEY` through `/api/fashion-scan` and deploys to Vercel with Nitro.

## Phase 2 - Measure scan accuracy

Build a repeatable internal benchmark for 20-30 representative fashion images. Do not add product
search or persistence while establishing this baseline.

Proposed files:

- `benchmarks/fashion-scan/manifest.json`: versioned cases and expected labels.
- `benchmarks/fashion-scan/images/`: local or private benchmark images; keep licensed/private images
  out of git.
- `benchmarks/fashion-scan/schema.ts`: typed benchmark case and result definitions.
- `benchmarks/fashion-scan/run.ts`: sequential runner using the existing scan contract.
- `benchmarks/fashion-scan/score.ts`: deterministic field scoring and hallucination checks.
- `benchmarks/fashion-scan/results/`: timestamped JSON outputs and a generated Markdown summary.

Suggested case shape:

```ts
type FashionBenchmarkCase = {
  id: string;
  imagePath: string;
  expectedItems: Array<{
    category: string;
    colors: string[];
    pattern: string | null;
    material: string | null;
    styles: string[];
    visibleBrand: string | null;
  }>;
  notes?: string;
};
```

Each run should capture category, color, pattern, material, style, visible-brand accuracy, brand
hallucinations, search-query usefulness, response time, invalid JSON, and failed scans. Keep raw
model output alongside normalized scores so failures can be audited.

## Phase 3 - Add real product search

Introduce a provider-neutral product-search interface. Send one strongest query per detected item
and display 6-12 product cards. Handle missing prices, unavailable products, and incomplete retailer
metadata. Do not split the first implementation into luxury, premium, and budget requests.

## Phase 4 - Add basic database logging

Persist a deliberately small model: `searches`, `product_results`, and optional
`scan_corrections`. Record the scan/search inputs, returned products, clicks, and corrections without
building the full ranking flywheel.

## Phase 5 - Add caching and ranking

Add verified-result reuse, image or embedding similarity, product freshness checks, click-informed
ranking, premium and affordable alternatives, and richer brand classification only after Phases 2-4
produce enough evidence.

## Phase 6 - Compare additional vision models

Add a generic `FashionVisionProvider` interface for controlled benchmark runs. Compare Gemini and
OpenAI against the Phase 2 dataset, never call both for every production scan, and change the
production model only when benchmark evidence supports it.
