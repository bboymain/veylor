-- Stage 13: privacy-safe anonymous preference learning.
--
-- Profiles are random UUIDs stored in a first-party HttpOnly cookie. They do
-- not contain names, email addresses, raw images, IP addresses, or ad IDs.
-- Preference evidence is learned only from persisted product clicks.

create table if not exists public.shopper_profiles (
  id uuid primary key,
  preferred_retailers jsonb not null default '{}'::jsonb,
  preferred_tiers jsonb not null default '{}'::jsonb,
  price_sum numeric not null default 0,
  price_count integer not null default 0,
  click_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.shopper_profiles'::regclass
      and conname = 'shopper_profiles_price_count_check'
  ) then
    alter table public.shopper_profiles
      add constraint shopper_profiles_price_count_check
      check (price_count >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.shopper_profiles'::regclass
      and conname = 'shopper_profiles_click_count_check'
  ) then
    alter table public.shopper_profiles
      add constraint shopper_profiles_click_count_check
      check (click_count >= 0) not valid;
  end if;
end $$;

alter table public.shopper_profiles
  validate constraint shopper_profiles_price_count_check;

alter table public.shopper_profiles
  validate constraint shopper_profiles_click_count_check;

create index if not exists shopper_profiles_updated_at_idx
  on public.shopper_profiles (updated_at desc);

create or replace function public.record_shopper_preference_click(
  p_profile_id uuid,
  p_search_id uuid,
  p_normalized_product_url text,
  p_clicked_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_retailer text;
  v_tier text;
  v_price numeric;
begin
  select
    coalesce(nullif(trim(p.retailer), ''), 'unknown'),
    coalesce(nullif(trim(a.classification_label), ''), 'unknown'),
    p.price
  into
    v_retailer,
    v_tier,
    v_price
  from public.alternatives a
  join public.products p on p.id = a.product_id
  where a.search_id = p_search_id
    and p.normalized_product_url = p_normalized_product_url
    and a.clicked = true
  order by a.clicked_at desc nulls last, a.created_at asc
  limit 1;

  if v_retailer is null then
    return false;
  end if;

  insert into public.shopper_profiles (
    id,
    preferred_retailers,
    preferred_tiers,
    price_sum,
    price_count,
    click_count,
    created_at,
    updated_at
  ) values (
    p_profile_id,
    jsonb_build_object(v_retailer, 1),
    jsonb_build_object(v_tier, 1),
    coalesce(v_price, 0),
    case when v_price is null then 0 else 1 end,
    1,
    p_clicked_at,
    p_clicked_at
  )
  on conflict (id) do update
  set
    preferred_retailers = jsonb_set(
      public.shopper_profiles.preferred_retailers,
      array[v_retailer],
      to_jsonb(coalesce((public.shopper_profiles.preferred_retailers ->> v_retailer)::integer, 0) + 1),
      true
    ),
    preferred_tiers = jsonb_set(
      public.shopper_profiles.preferred_tiers,
      array[v_tier],
      to_jsonb(coalesce((public.shopper_profiles.preferred_tiers ->> v_tier)::integer, 0) + 1),
      true
    ),
    price_sum = public.shopper_profiles.price_sum + coalesce(v_price, 0),
    price_count = public.shopper_profiles.price_count + case when v_price is null then 0 else 1 end,
    click_count = public.shopper_profiles.click_count + 1,
    updated_at = p_clicked_at;

  return true;
end;
$$;

revoke all on function public.record_shopper_preference_click(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.record_shopper_preference_click(uuid, uuid, text, timestamptz)
  to service_role;

create or replace function public.get_shopper_preferences(
  p_profile_id uuid
)
returns table (
  preferred_retailers jsonb,
  preferred_tiers jsonb,
  average_price numeric,
  click_count integer
)
language sql
security definer
set search_path = public
stable
as $$
  select
    sp.preferred_retailers,
    sp.preferred_tiers,
    case
      when sp.price_count > 0 then sp.price_sum / sp.price_count
      else null
    end as average_price,
    sp.click_count
  from public.shopper_profiles sp
  where sp.id = p_profile_id
  limit 1;
$$;

revoke all on function public.get_shopper_preferences(uuid)
  from public, anon, authenticated;

grant execute on function public.get_shopper_preferences(uuid)
  to service_role;

alter table public.shopper_profiles enable row level security;