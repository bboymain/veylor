-- Phase 7: brand/product intelligence foundation.
--
-- Adds brands, products, and alternatives tables so SerpApi candidates can be
-- normalized, deterministically classified, and linked to existing searches
-- rows. This phase changes storage and server logic only — the visible
-- product-card labels still use the temporary price-based tiers.
--
-- Design notes:
--   * Authenticity is represented separately from market/price tier.
--     `market_tier` describes a brand's market segment; `authenticity_status`
--     describes evidence that a specific listing is genuine. Price alone never
--     produces authenticity.
--   * All writes happen server-side with the service-role key. RLS is enabled
--     with no policies, so anon/authenticated clients have no access (same
--     pattern as public.searches).
--   * The existing searches table is not modified; its click fields remain.

-- ---------------------------------------------------------------------------
-- brands
-- ---------------------------------------------------------------------------
create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  -- Lowercased, diacritic-stripped, alphanumeric-only form of display_name
  -- (see normalizeBrandName in src/lib/product-classification.server.ts).
  normalized_name text unique not null,
  -- Aliases are stored pre-normalized with the same rules as normalized_name.
  aliases text[] not null default '{}',
  market_tier text not null default 'unknown'
    check (market_tier in ('luxury', 'premium', 'mid_market', 'budget', 'unknown')),
  -- Whether this brand *record* has been verified by a maintainer. This is
  -- not a claim about any listing's authenticity.
  verification_status text not null default 'unknown'
    check (verification_status in ('verified', 'unverified', 'unknown')),
  -- Registrable domains (no scheme, no www) operated by the brand itself.
  official_domains text[] not null default '{}',
  -- Retailer names/domains known to carry genuine stock. Entries are matched
  -- deterministically (normalized name or domain suffix).
  trusted_retailers text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.brands enable row level security;
-- No policies: server-only access via the service-role key.

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  -- Provider-scoped identifier (e.g. the SerpApi result id). Not unique on
  -- its own; providers recycle/omit ids.
  external_id text,
  source text not null,
  title text not null,
  normalized_title text not null,
  brand_id uuid references public.brands (id) on delete set null,
  -- What the scan/user reported, verbatim (trimmed). Stored even when no
  -- brands row matched; it is a detection, not a verification.
  detected_brand_name text,
  product_url text not null,
  -- Canonicalized URL (lowercased host, no fragment, tracking params removed,
  -- sorted query, no trailing slash) — see normalizeProductUrl.
  normalized_product_url text not null,
  retailer text,
  retailer_domain text,
  image_url text,
  price numeric,
  currency text,
  market_tier text not null default 'unknown'
    check (market_tier in ('luxury', 'premium', 'mid_market', 'budget', 'unknown')),
  authenticity_status text not null default 'unknown'
    check (authenticity_status in ('verified', 'likely', 'unknown', 'suspicious')),
  classification_confidence numeric
    check (
      classification_confidence is null
      or (classification_confidence >= 0 and classification_confidence <= 1)
    ),
  classification_reason text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Identity is the normalized URL per source. Titles are never unique
  -- identifiers.
  constraint products_source_normalized_url_key unique (source, normalized_product_url)
);

create index if not exists products_brand_id_idx on public.products (brand_id);
create index if not exists products_last_seen_at_idx on public.products (last_seen_at desc);

alter table public.products enable row level security;
-- No policies: server-only access via the service-role key.

-- ---------------------------------------------------------------------------
-- alternatives: which product candidates were shown for which search.
-- ---------------------------------------------------------------------------
create table if not exists public.alternatives (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  -- 1-based position in the product list returned to the user.
  result_rank integer not null check (result_rank >= 1),
  query_used text not null,
  provider text not null,
  classification_label text,
  classification_reason text,
  clicked boolean not null default false,
  clicked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint alternatives_search_product_key unique (search_id, product_id)
);

create index if not exists alternatives_search_id_idx on public.alternatives (search_id);
create index if not exists alternatives_product_id_idx on public.alternatives (product_id);

alter table public.alternatives enable row level security;
-- No policies: server-only access via the service-role key.

-- ---------------------------------------------------------------------------
-- Development/testing seed data.
--
-- Deliberately tiny: one recognizable brand per market tier so the classifier
-- has deterministic fixtures. This is NOT exhaustive brand coverage and makes
-- no counterfeit-market assumptions. Expand via later migrations by copying
-- this insert pattern. Aliases are stored pre-normalized (lowercase,
-- alphanumeric only). Official domains are included only where confidently
-- known; trusted_retailers is intentionally left empty rather than guessed.
-- ---------------------------------------------------------------------------
insert into public.brands
  (display_name, normalized_name, aliases, market_tier, verification_status, official_domains, trusted_retailers, notes)
values
  ('Gucci', 'gucci', '{}', 'luxury', 'verified', '{gucci.com}', '{}',
   'Development seed row. Expand aliases/retailers in a later migration.'),
  ('Coach', 'coach', '{coachnewyork}', 'premium', 'verified', '{coach.com}', '{}',
   'Development seed row. Expand aliases/retailers in a later migration.'),
  ('Levi''s', 'levis', '{levistrauss,levistraussco}', 'mid_market', 'verified', '{levi.com}', '{}',
   'Development seed row. Expand aliases/retailers in a later migration.'),
  ('H&M', 'hm', '{hennesmauritz,handm}', 'budget', 'verified', '{hm.com}', '{}',
   'Development seed row. Expand aliases/retailers in a later migration.')
on conflict (normalized_name) do nothing;
