-- Stage 10: evidence-based verification.
--
-- A click verifies only the persisted alternative/product relationship that the
-- user actually selected. AI confidence, price, title matching, and brand
-- classification never promote verification. A scan becomes reusable only
-- when the clicked alternative belongs to that successful fingerprinted scan.

alter table public.products
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists verified_at timestamptz,
  add column if not exists verification_evidence text,
  add column if not exists verified_by_search_id uuid;

alter table public.alternatives
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists verified_at timestamptz,
  add column if not exists verification_evidence text;

alter table public.searches
  add column if not exists cache_verification_evidence text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_verification_status_check'
  ) then
    alter table public.products
      add constraint products_verification_status_check
      check (verification_status in ('unverified', 'verified', 'rejected')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.alternatives'::regclass
      and conname = 'alternatives_verification_status_check'
  ) then
    alter table public.alternatives
      add constraint alternatives_verification_status_check
      check (verification_status in ('unverified', 'verified', 'rejected')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_verified_by_search_id_fkey'
  ) then
    alter table public.products
      add constraint products_verified_by_search_id_fkey
      foreign key (verified_by_search_id) references public.searches (id)
      on delete set null not valid;
  end if;
end $$;

alter table public.products validate constraint products_verification_status_check;
alter table public.alternatives validate constraint alternatives_verification_status_check;
alter table public.products validate constraint products_verified_by_search_id_fkey;

create index if not exists products_verified_cache_idx
  on public.products (last_seen_at desc)
  where verification_status = 'verified';

create index if not exists alternatives_verified_search_idx
  on public.alternatives (search_id, verified_at desc)
  where verification_status = 'verified';

create or replace function public.verify_product_click(
  p_search_id uuid,
  p_normalized_product_url text,
  p_clicked_at timestamptz default now()
)
returns table (
  alternative_verified boolean,
  product_verified boolean,
  search_cache_verified boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alternative_id uuid;
  v_product_id uuid;
  v_search_type text;
  v_search_status text;
  v_image_sha256 text;
begin
  select a.id, a.product_id, s.search_type, s.status, s.image_sha256
    into v_alternative_id, v_product_id, v_search_type, v_search_status, v_image_sha256
  from public.alternatives a
  join public.products p on p.id = a.product_id
  join public.searches s on s.id = a.search_id
  where a.search_id = p_search_id
    and p.normalized_product_url = p_normalized_product_url
  order by a.created_at asc
  limit 1
  for update of a, p, s;

  if v_alternative_id is null then
    return query select false, false, false;
    return;
  end if;

  update public.alternatives
  set clicked = true,
      clicked_at = coalesce(clicked_at, p_clicked_at),
      verification_status = 'verified',
      verified_at = coalesce(verified_at, p_clicked_at),
      verification_evidence = 'user_product_click'
  where id = v_alternative_id;

  update public.products
  set verification_status = 'verified',
      verified_at = coalesce(verified_at, p_clicked_at),
      verification_evidence = 'user_product_click',
      verified_by_search_id = coalesce(verified_by_search_id, p_search_id),
      updated_at = now()
  where id = v_product_id;

  if v_search_type = 'scan'
     and v_search_status = 'success'
     and v_image_sha256 is not null
     and length(v_image_sha256) = 64 then
    update public.searches
    set cache_status = 'verified',
        cache_verified_at = coalesce(cache_verified_at, p_clicked_at),
        cache_verification_evidence = 'persisted_alternative_click'
    where id = p_search_id;

    return query select true, true, true;
  else
    return query select true, true, false;
  end if;
end;
$$;

revoke all on function public.verify_product_click(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.verify_product_click(uuid, text, timestamptz)
  to service_role;

alter table public.searches enable row level security;
alter table public.products enable row level security;
alter table public.alternatives enable row level security;