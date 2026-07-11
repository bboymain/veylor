-- Stage 11: relationship-scoped alternative impressions and product freshness.
--
-- This migration is additive and non-destructive. It records only alternatives
-- that were actually persisted for a known search. Provider order is preserved;
-- Stage 11 gathers trustworthy ranking evidence without changing result order.

alter table public.alternatives
  add column if not exists impression_count integer not null default 0,
  add column if not exists first_impression_at timestamptz,
  add column if not exists last_impression_at timestamptz;

alter table public.products
  add column if not exists freshness_status text not null default 'unknown',
  add column if not exists freshness_checked_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.alternatives'::regclass
      and conname = 'alternatives_impression_count_check'
  ) then
    alter table public.alternatives
      add constraint alternatives_impression_count_check
      check (impression_count >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_freshness_status_check'
  ) then
    alter table public.products
      add constraint products_freshness_status_check
      check (freshness_status in ('unknown', 'fresh', 'stale', 'unavailable')) not valid;
  end if;
end $$;

alter table public.alternatives
  validate constraint alternatives_impression_count_check;

alter table public.products
  validate constraint products_freshness_status_check;

create index if not exists alternatives_last_impression_idx
  on public.alternatives (last_impression_at desc)
  where impression_count > 0;

create index if not exists products_freshness_idx
  on public.products (freshness_status, freshness_checked_at desc);

create or replace function public.record_alternative_impressions(
  p_search_id uuid,
  p_product_ids uuid[],
  p_shown_at timestamptz default now()
)
returns table (
  alternatives_updated integer,
  products_refreshed integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alternatives_updated integer := 0;
  v_products_refreshed integer := 0;
begin
  if p_search_id is null
     or p_product_ids is null
     or cardinality(p_product_ids) = 0 then
    return query select 0, 0;
    return;
  end if;

  with updated_alternatives as (
    update public.alternatives a
    set
      impression_count = a.impression_count + 1,
      first_impression_at = coalesce(a.first_impression_at, p_shown_at),
      last_impression_at = p_shown_at
    where a.search_id = p_search_id
      and a.product_id = any(p_product_ids)
    returning a.product_id
  )
  select count(*)::integer
  into v_alternatives_updated
  from updated_alternatives;

  with refreshed_products as (
    update public.products p
    set
      freshness_status = 'fresh',
      freshness_checked_at = p_shown_at,
      last_seen_at = greatest(p.last_seen_at, p_shown_at),
      updated_at = now()
    where p.id in (
      select distinct a.product_id
      from public.alternatives a
      where a.search_id = p_search_id
        and a.product_id = any(p_product_ids)
    )
    returning p.id
  )
  select count(*)::integer
  into v_products_refreshed
  from refreshed_products;

  return query select v_alternatives_updated, v_products_refreshed;
end;
$$;

revoke all on function public.record_alternative_impressions(uuid, uuid[], timestamptz)
  from public, anon, authenticated;

grant execute on function public.record_alternative_impressions(uuid, uuid[], timestamptz)
  to service_role;

alter table public.products enable row level security;
alter table public.alternatives enable row level security;
