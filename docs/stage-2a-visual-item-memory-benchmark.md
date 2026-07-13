# Stage 2A — Private Visual Item-Memory Feasibility Benchmark

## Purpose

Determine, offline and privately, whether Veylor can reliably recognize the same fashion item
across different photos, angles, crops, lighting, backgrounds, and users **before** adding
pgvector or any production visual memory. This stage is benchmark-only: no production vector
search, no pgvector installation, no production embedding tables, no scan-flow changes, no
deployment, and no paid API calls.

## Layout

```text
benchmarks/visual-item-memory/
  schema.ts               versioned manifest/case schema, stable case + idempotency keys
  provider.ts             injectable embedding provider interface + deterministic mock
  local-provider.ts       OPTIONAL loopback-only local provider (explicit CLI flag only)
  evaluate.ts             cosine similarity, ranking metrics, confusion counts, sweeps
  run.ts                  sequential runner (provider always injected, no network here)
  persistence.ts          idempotent run persistence: in-memory (tests) + private local JSON
  variants.ts             dependency-free PNG tooling for synthetic fixtures/perturbations
  manifest.example.json   metadata-only example dataset (authored mock signatures, no images)
  results/                UNTRACKED private run output (gitignored)
  private-images/         UNTRACKED private fixture images (gitignored)
scripts/visual-memory-benchmark.ts   private CLI (bun run visual-memory-benchmark)
```

## Dataset rules

- Benchmark images and results are private. `results/`, `private-images/`, and
  `manifest.local.json` are gitignored; the privacy tests fail if that changes or if any
  route/client module references the suite.
- Never commit copyrighted retailer images or personal shopper photos. Preferred sources, in
  order: synthetic fixtures (`make-synthetic`), locally generated perturbations
  (`make-variants`), existing approved private benchmark assets, metadata-only placeholders.
- Generated variants are **synthetic perturbations**. They approximate crop/lighting/quality
  changes but are not equivalent to real photos taken by different users; they are labeled
  `synthetic: true` everywhere and results must be read with that caveat.

## Running

```bash
# Validate a manifest
bun run visual-memory-benchmark validate --manifest benchmarks/visual-item-memory/manifest.example.json

# Dry run (zero writes anywhere) with the deterministic mock provider
bun run visual-memory-benchmark run --dry-run --verbose

# Persisted private run with a custom sweep
bun run visual-memory-benchmark run --thresholds 0.5:0.95:0.05 --top-k 3

# Generate synthetic fixtures and perturbation variants (local, dependency-free)
bun run visual-memory-benchmark make-synthetic --out benchmarks/visual-item-memory/private-images
bun run visual-memory-benchmark make-variants --source benchmarks/visual-item-memory/private-images/veylor-synthetic-item-1.png --out benchmarks/visual-item-memory/private-images
```

The optional local provider (`--provider local --local-model <name> --dimension <n>`) talks only
to a loopback embedding server the developer already runs (for example Ollama with a
vision-embedding model installed manually). It never downloads models, is never used by tests or
CI, and non-loopback URLs are rejected.

## Metrics

Each run records provider/model/version/dimension, per-case candidate similarities, top-1
accuracy, same-item recall@k, false-positive and false-negative rates, a full confusion matrix
per threshold, per-category and per-condition breakdowns, latency percentiles, sanitized
failures, configuration, and stable idempotency keys. **No production threshold is chosen in
this stage**; the CLI always reports a threshold sweep showing the recall/false-positive
tradeoff instead.

## Storage decision: why results are local-only for now

The Stage 31–35 Supabase benchmark schema cannot represent visual results without semantic
abuse:

- `fashion_benchmark_cases.expected_items` is constrained (table CHECK + `upsert` RPC) to
  fashion label objects with `category` and non-empty `colors`; a visual case is a query image
  plus candidate images with expected relationships.
- `fashion_benchmark_cases.image_storage_path` holds exactly one image; visual cases need one
  query plus N candidates.
- `fashion_benchmark_results` has fixed per-field fashion score columns and no place for
  candidate similarities, top-k metrics, confusion counts, threshold sweeps, embedding
  dimension, or model version.

Per the stage rules, no migration was created. Runs persist to the private, untracked
`results/` directory using the same sha256→UUID idempotency scheme as the fashion-scan
benchmark.

### Smallest additive migration proposal (NOT created — awaiting approval)

Two service-role-only tables mirroring the Stage 32 security pattern (RLS enabled, all grants
revoked from `public`/`anon`/`authenticated`):

- `visual_benchmark_runs(id uuid pk, idempotency_key text unique, provider text, model text,
model_version text, embedding_dimension int, status text, config jsonb, metrics jsonb,
threshold_sweep jsonb, failure_count int, started_at, completed_at, created_at)`
- `visual_benchmark_case_results(id uuid pk, run_id uuid fk, case_id text,
case_idempotency_key text, status text, candidate_similarities jsonb, top1_is_same_item
boolean, failures jsonb, created_at, unique(run_id, case_id))`

No changes to any existing table or function; existing fashion benchmark data is untouched.

## Trust boundaries

- The suite never imports production server modules and never references model-promotion,
  verification, acceptance, cache, or ranking RPCs (enforced by `privacy.test.ts`).
- No Supabase access of any kind exists in the suite today, so runs cannot mutate any
  production state.
- All automated tests use the deterministic mock provider; no live model calls exist anywhere
  in the suite or its tests.
