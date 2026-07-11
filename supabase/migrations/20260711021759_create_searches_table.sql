-- Phase 4: minimal search logging.
-- One row per scan attempt (success or failure), optionally updated once when
-- the user clicks a product result. All writes happen server-side with the
-- service-role key; no anon/authenticated policies are defined, so RLS denies
-- all client access by default.

create table if not exists public.searches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Scan attempt outcome.
  status text not null check (status in ('success', 'error')),
  model text,
  summary text,
  detected_items jsonb,
  primary_search_query text,
  error_message text,

  -- Product-click tracking (set at most once, after the scan row exists).
  clicked boolean not null default false,
  clicked_at timestamptz,
  clicked_product_url text,
  clicked_product_title text,
  clicked_retailer text,
  clicked_tier text
);

create index if not exists searches_created_at_idx on public.searches (created_at desc);

alter table public.searches enable row level security;
-- No policies are defined: anon and authenticated roles have no access.
-- The server-only service-role key bypasses RLS for inserts/updates.
