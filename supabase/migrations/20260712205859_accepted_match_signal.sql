-- Explicit accepted-match signal and click/identity separation.
--
-- Acceptance belongs to the persisted search-result relationship. It records
-- an explicit user confirmation for ranking and future learning only; neither
-- acceptance nor a click verifies product identity, authenticity, brand trust,
-- classification, cache eligibility, benchmark state, or model promotion.

alter table public.alternatives
  add column if not exists accepted_match boolean not null default false,
  add column if not exists accepted_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.alternatives'::regclass
      and conname = 'alternatives_accepted_match_timestamp_check'
  ) then
    alter table public.alternatives
      add constraint alternatives_accepted_match_timestamp_check
      check (
        (accepted_match = false and accepted_at is null)
        or (accepted_match = true and accepted_at is not null)
      ) not valid;
  end if;
end $$;

alter table public.alternatives
  validate constraint alternatives_accepted_match_timestamp_check;

-- Atomically accepts one existing search/alternative/product relationship.
-- Repeated calls preserve the first acceptance timestamp and still succeed.
create or replace function public.accept_alternative_match(
  p_search_id uuid,
  p_normalized_url text,
  p_accepted_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alternative_id uuid;
begin
  select a.id
    into v_alternative_id
  from public.alternatives a
  join public.products p on p.id = a.product_id
  join public.searches s on s.id = a.search_id
  where a.search_id = p_search_id
    and p.normalized_product_url = p_normalized_url
  order by a.created_at asc
  limit 1
  for update of a;

  if v_alternative_id is null then
    return false;
  end if;

  update public.alternatives
  set accepted_match = true,
      accepted_at = coalesce(accepted_at, p_accepted_at, now())
  where id = v_alternative_id;

  return true;
end;
$$;

revoke all on function public.accept_alternative_match(uuid, text, timestamptz) from public;
revoke all on function public.accept_alternative_match(uuid, text, timestamptz) from anon;
revoke all on function public.accept_alternative_match(uuid, text, timestamptz) from authenticated;
grant execute on function public.accept_alternative_match(uuid, text, timestamptz) to service_role;

-- Compatibility replacement for the legacy Stage 10 RPC. Despite its name,
-- it now records alternative click interest only and always returns neutral
-- verification results. The signature and result shape remain stable so
-- existing callers do not need a coordinated rollout.
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
begin
  select a.id
    into v_alternative_id
  from public.alternatives a
  join public.products p on p.id = a.product_id
  join public.searches s on s.id = a.search_id
  where a.search_id = p_search_id
    and p.normalized_product_url = p_normalized_product_url
  order by a.created_at asc
  limit 1
  for update of a;

  if v_alternative_id is not null then
    update public.alternatives
    set clicked = true,
        clicked_at = coalesce(clicked_at, p_clicked_at)
    where id = v_alternative_id;
  end if;

  return query select false, false, false;
end;
$$;

revoke all on function public.verify_product_click(uuid, text, timestamptz) from public;
revoke all on function public.verify_product_click(uuid, text, timestamptz) from anon;
revoke all on function public.verify_product_click(uuid, text, timestamptz) from authenticated;
grant execute on function public.verify_product_click(uuid, text, timestamptz) to service_role;

-- Preserve the existing server-only table boundary. No anon/authenticated
-- policies or grants are added by this migration.
alter table public.alternatives enable row level security;
