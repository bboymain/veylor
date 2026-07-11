-- Stage 9: cache-first exact-image scan lookup.
--
-- All existing scan rows remain unverified by default. Stage 9 only serves rows
-- explicitly promoted to `verified`; Stage 10 will define evidence-based
-- promotion rules. This migration is additive and preserves existing data.

alter table public.searches
  add column if not exists image_sha256 text,
  add column if not exists cache_status text not null default 'unverified',
  add column if not exists cache_verified_at timestamptz,
  add column if not exists cache_source_search_id uuid,
  add column if not exists last_cache_hit_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.searches'::regclass
      and conname = 'searches_cache_status_check'
  ) then
    alter table public.searches
      add constraint searches_cache_status_check
      check (cache_status in ('unverified', 'verified', 'rejected')) not valid;
  end if;
end $$;

alter table public.searches validate constraint searches_cache_status_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.searches'::regclass
      and conname = 'searches_cache_source_search_id_fkey'
  ) then
    alter table public.searches
      add constraint searches_cache_source_search_id_fkey
      foreign key (cache_source_search_id) references public.searches (id)
      on delete set null not valid;
  end if;
end $$;

alter table public.searches validate constraint searches_cache_source_search_id_fkey;

create index if not exists searches_verified_image_cache_idx
  on public.searches (image_sha256, cache_verified_at desc, created_at desc)
  where status = 'success'
    and search_type = 'scan'
    and cache_status = 'verified'
    and image_sha256 is not null;

create index if not exists searches_cache_source_idx
  on public.searches (cache_source_search_id)
  where cache_source_search_id is not null;

alter table public.searches enable row level security;
