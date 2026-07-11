-- Stage 24: privacy-safe model quality maintenance health.
--
-- Returns aggregate operational status only. No shopper identifiers, raw scan
-- payloads, item text, correction values, image hashes, model-level metrics, or
-- individual scan IDs are exposed. Access remains service-role-only.

create or replace function public.get_model_quality_maintenance_health(
  p_now timestamptz default now(),
  p_stale_after interval default interval '8 days'
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with latest_completed_run as (
    select
      mqr.period_started_at,
      mqr.period_ended_at,
      mqr.snapshots_written,
      mqr.regressions_detected,
      mqr.completed_at
    from public.model_quality_maintenance_runs mqr
    where mqr.status = 'completed'
    order by mqr.completed_at desc, mqr.id desc
    limit 1
  ),
  regression_totals as (
    select
      count(*) filter (
        where mqr.acknowledged_at is null
      )::integer as unacknowledged_regressions
    from public.model_quality_regressions mqr
  ),
  latest_snapshot as (
    select
      max(mqs.period_ended_at) as latest_snapshot_period_ended_at
    from public.model_quality_snapshots mqs
  ),
  health as (
    select
      lcr.period_started_at,
      lcr.period_ended_at,
      lcr.snapshots_written,
      lcr.regressions_detected,
      lcr.completed_at,
      rt.unacknowledged_regressions,
      ls.latest_snapshot_period_ended_at,
      lcr.completed_at is null as has_never_run,
      case
        when lcr.completed_at is null then true
        else lcr.completed_at + p_stale_after <= p_now
      end as is_stale
    from regression_totals rt
    cross join latest_snapshot ls
    left join latest_completed_run lcr on true
  )
  select jsonb_build_object(
    'checkedAt', p_now,
    'staleAfterSeconds', greatest(
      floor(extract(epoch from p_stale_after))::bigint,
      0
    ),
    'status', case
      when health.has_never_run then 'never_run'
      when health.is_stale then 'stale'
      when health.unacknowledged_regressions > 0 then 'attention_required'
      else 'healthy'
    end,
    'hasNeverRun', health.has_never_run,
    'isStale', health.is_stale,
    'unacknowledgedRegressions', health.unacknowledged_regressions,
    'latestRun', case
      when health.completed_at is null then null
      else jsonb_build_object(
        'periodStartedAt', health.period_started_at,
        'periodEndedAt', health.period_ended_at,
        'snapshotsWritten', health.snapshots_written,
        'regressionsDetected', health.regressions_detected,
        'completedAt', health.completed_at
      )
    end,
    'latestSnapshotPeriodEndedAt', health.latest_snapshot_period_ended_at
  )
  from health;
$$;

revoke all on function public.get_model_quality_maintenance_health(
  timestamptz,
  interval
) from public, anon, authenticated;

grant execute on function public.get_model_quality_maintenance_health(
  timestamptz,
  interval
) to service_role;

alter table public.model_quality_maintenance_runs
  enable row level security;

alter table public.model_quality_snapshots
  enable row level security;

alter table public.model_quality_regressions
  enable row level security;
