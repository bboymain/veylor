-- Stage 8: audit and align the four-table database foundation.
--
-- This migration is intentionally additive and non-destructive. It preserves
-- all existing searches, brands, products, alternatives, and legacy click
-- fields while repairing foundation-level metadata, relationships, indexes,
-- and updated_at behavior.

-- ---------------------------------------------------------------------------
-- searches: preserve the Phase 4 logging table while making its purpose clear.
-- ---------------------------------------------------------------------------
alter table public.searches
  add column if not exists search_type text,
  add column if not exists updated_at timestamptz;

update public.searches
set search_type = case when model = 'manual' then 'manual' else 'scan' end
where search_type is null;

update public.searches
set updated_at = created_at
where updated_at is null;

alter table public.searches
  alter column search_type set default 'scan',
  alter column search_type set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.searches'::regclass
      and conname = 'searches_search_type_check'
  ) then
    alter table public.searches
      add constraint searches_search_type_check
      check (search_type in ('scan', 'manual')) not valid;
  end if;
end $$;

alter table public.searches validate constraint searches_search_type_check;

create index if not exists searches_type_created_at_idx
  on public.searches (search_type, created_at desc);

-- ---------------------------------------------------------------------------
-- Relationship and lookup indexes. Existing foreign keys are preserved; the
-- DO blocks add them only when the relevant column has no FK yet.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f'
      and c.conrelid = 'public.products'::regclass
      and a.attname = 'brand_id'
  ) then
    alter table public.products
      add constraint products_brand_id_fkey
      foreign key (brand_id) references public.brands (id)
      on delete set null not valid;
  end if;
end $$;

alter table public.products validate constraint products_brand_id_fkey;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f'
      and c.conrelid = 'public.alternatives'::regclass
      and a.attname = 'search_id'
  ) then
    alter table public.alternatives
      add constraint alternatives_search_id_fkey
      foreign key (search_id) references public.searches (id)
      on delete cascade not valid;
  end if;
end $$;

alter table public.alternatives validate constraint alternatives_search_id_fkey;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f'
      and c.conrelid = 'public.alternatives'::regclass
      and a.attname = 'product_id'
  ) then
    alter table public.alternatives
      add constraint alternatives_product_id_fkey
      foreign key (product_id) references public.products (id)
      on delete cascade not valid;
  end if;
end $$;

alter table public.alternatives validate constraint alternatives_product_id_fkey;

create index if not exists products_source_external_id_idx
  on public.products (source, external_id)
  where external_id is not null;

create index if not exists products_source_normalized_url_idx
  on public.products (source, normalized_product_url);

create index if not exists alternatives_search_rank_idx
  on public.alternatives (search_id, result_rank);

create index if not exists alternatives_clicked_at_idx
  on public.alternatives (clicked_at desc)
  where clicked = true;

-- ---------------------------------------------------------------------------
-- Consistent updated_at handling for mutable foundation tables.
-- ---------------------------------------------------------------------------
alter table public.alternatives
  add column if not exists updated_at timestamptz;

update public.alternatives
set updated_at = created_at
where updated_at is null;

alter table public.alternatives
  alter column updated_at set default now(),
  alter column updated_at set not null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists searches_set_updated_at on public.searches;
create trigger searches_set_updated_at
before update on public.searches
for each row execute function public.set_updated_at();

drop trigger if exists brands_set_updated_at on public.brands;
create trigger brands_set_updated_at
before update on public.brands
for each row execute function public.set_updated_at();

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists alternatives_set_updated_at on public.alternatives;
create trigger alternatives_set_updated_at
before update on public.alternatives
for each row execute function public.set_updated_at();

-- Keep every foundation table server-only. No client policies are added.
alter table public.searches enable row level security;
alter table public.brands enable row level security;
alter table public.products enable row level security;
alter table public.alternatives enable row level security;
