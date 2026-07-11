-- Stage 25: server-only model regression alert acknowledgment.
--
-- Regression rows remain as an immutable operational history. Acknowledgment
-- records only when an alert was reviewed; it never deletes quality evidence
-- and exposes no shopper identifiers, scans, item text, corrections, or images.

create or replace function public.get_model_quality_regressions(
  p_since timestamptz default (now() - interval '180 days'),
  p_unacknowledged_only boolean default true
)
returns table (
  regression_id uuid,
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
    mqr.id as regression_id,
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
  order by
    mqr.detected_at desc,
    mqr.model asc;
$$;

create or replace function public.acknowledge_model_quality_regression(
  p_regression_id uuid,
  p_acknowledged_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
begin
  if p_regression_id is null
     or p_acknowledged_at is null then
    return false;
  end if;

  update public.model_quality_regressions
  set acknowledged_at = p_acknowledged_at
  where id = p_regression_id
    and acknowledged_at is null;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.acknowledge_model_quality_regressions_for_model(
  p_model text,
  p_acknowledged_at timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
  v_model text;
begin
  v_model := nullif(trim(p_model), '');

  if v_model is null
     or p_acknowledged_at is null then
    return 0;
  end if;

  update public.model_quality_regressions
  set acknowledged_at = p_acknowledged_at
  where model = v_model
    and acknowledged_at is null;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.get_model_quality_regressions(
  timestamptz,
  boolean
) from public, anon, authenticated;

revoke all on function public.acknowledge_model_quality_regression(
  uuid,
  timestamptz
) from public, anon, authenticated;

revoke all on function public.acknowledge_model_quality_regressions_for_model(
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.get_model_quality_regressions(
  timestamptz,
  boolean
) to service_role;

grant execute on function public.acknowledge_model_quality_regression(
  uuid,
  timestamptz
) to service_role;

grant execute on function public.acknowledge_model_quality_regressions_for_model(
  text,
  timestamptz
) to service_role;

alter table public.model_quality_regressions
  enable row level security;

alter table public.model_quality_snapshots
  enable row level security;
