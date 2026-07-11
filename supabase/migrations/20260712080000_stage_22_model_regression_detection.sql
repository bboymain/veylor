-- Stage 22: privacy-safe model quality regression detection.
--
-- Compares usable aggregate snapshots only. No shopper identifiers, raw scans,
-- correction values, item text, image hashes, or individual scan IDs are stored.

create table if not exists public.model_quality_regressions (
  id uuid primary key default gen_random_uuid(),
  model text not null,
  previous_snapshot_id uuid not null
    references public.model_quality_snapshots(id) on delete cascade,
  current_snapshot_id uuid not null
    references public.model_quality_snapshots(id) on delete cascade,
  previous_correction_rate numeric not null,
  current_correction_rate numeric not null,
  correction_rate_increase numeric not null,
  threshold_used numeric not null,
  detected_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  unique (previous_snapshot_id, current_snapshot_id)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.model_quality_regressions'::regclass
      and conname = 'model_quality_regressions_snapshot_order_check'
  ) then
    alter table public.model_quality_regressions
      add constraint model_quality_regressions_snapshot_order_check
      check (previous_snapshot_id <> current_snapshot_id) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.model_quality_regressions'::regclass
      and conname = 'model_quality_regressions_rates_check'
  ) then
    alter table public.model_quality_regressions
      add constraint model_quality_regressions_rates_check
      check (
        previous_correction_rate between 0 and 1
        and current_correction_rate between 0 and 1
        and correction_rate_increase >= 0
        and threshold_used > 0
        and threshold_used <= 1
      ) not valid;
  end if;
end $$;

alter table public.model_quality_regressions
  validate constraint model_quality_regressions_snapshot_order_check;

alter table public.model_quality_regressions
  validate constraint model_quality_regressions_rates_check;

create index if not exists model_quality_regressions_model_detected_idx
  on public.model_quality_regressions (model, detected_at desc);

create or replace function public.detect_model_quality_regressions(
  p_since timestamptz default (now() - interval '180 days'),
  p_minimum_rate_increase numeric default 0.05
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  if p_minimum_rate_increase <= 0
     or p_minimum_rate_increase > 1 then
    return 0;
  end if;

  with usable as (
    select
      mqs.*,
      lag(mqs.id) over (
        partition by mqs.model
        order by mqs.period_ended_at, mqs.created_at, mqs.id
      ) as previous_snapshot_id,
      lag(mqs.correction_rate) over (
        partition by mqs.model
        order by mqs.period_ended_at, mqs.created_at, mqs.id
      ) as previous_correction_rate
    from public.model_quality_snapshots mqs
    where mqs.sample_usable = true
      and mqs.period_ended_at >= coalesce(
        p_since,
        '-infinity'::timestamptz
      )
  ), regressions as (
    select
      u.model,
      u.previous_snapshot_id,
      u.id as current_snapshot_id,
      u.previous_correction_rate,
      u.correction_rate as current_correction_rate,
      u.correction_rate - u.previous_correction_rate
        as correction_rate_increase
    from usable u
    where u.previous_snapshot_id is not null
      and u.previous_correction_rate is not null
      and u.correction_rate - u.previous_correction_rate
        >= p_minimum_rate_increase
  )
  insert into public.model_quality_regressions (
    model,
    previous_snapshot_id,
    current_snapshot_id,
    previous_correction_rate,
    current_correction_rate,
    correction_rate_increase,
    threshold_used
  )
  select
    r.model,
    r.previous_snapshot_id,
    r.current_snapshot_id,
    r.previous_correction_rate,
    r.current_correction_rate,
    r.correction_rate_increase,
    p_minimum_rate_increase
  from regressions r
  on conflict (previous_snapshot_id, current_snapshot_id)
  do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.get_model_quality_regressions(
  p_since timestamptz default (now() - interval '180 days'),
  p_unacknowledged_only boolean default true
)
returns table (
  model text,
  previous_period_started_at timestamptz,
  previous_period_ended_at timestamptz,
  current_period_started_at timestamptz,
  current_period_ended_at timestamptz,
  previous_correction_rate numeric,
  current_correction_rate numeric,
  correction_rate_increase numeric,
  threshold_used numeric,
  detected_at timestamptz,
  acknowledged_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    mqr.model,
    previous.period_started_at,
    previous.period_ended_at,
    current.period_started_at,
    current.period_ended_at,
    mqr.previous_correction_rate,
    mqr.current_correction_rate,
    mqr.correction_rate_increase,
    mqr.threshold_used,
    mqr.detected_at,
    mqr.acknowledged_at
  from public.model_quality_regressions mqr
  join public.model_quality_snapshots previous
    on previous.id = mqr.previous_snapshot_id
  join public.model_quality_snapshots current
    on current.id = mqr.current_snapshot_id
  where mqr.detected_at >= coalesce(
    p_since,
    '-infinity'::timestamptz
  )
    and (
      not p_unacknowledged_only
      or mqr.acknowledged_at is null
    )
  order by mqr.detected_at desc, mqr.model asc;
$$;

revoke all on function public.detect_model_quality_regressions(
  timestamptz,
  numeric
) from public, anon, authenticated;

revoke all on function public.get_model_quality_regressions(
  timestamptz,
  boolean
) from public, anon, authenticated;

grant execute on function public.detect_model_quality_regressions(
  timestamptz,
  numeric
) to service_role;

grant execute on function public.get_model_quality_regressions(
  timestamptz,
  boolean
) to service_role;

alter table public.model_quality_regressions enable row level security;
alter table public.model_quality_snapshots enable row level security;