-- Stage 27: privacy-safe scheduled maintenance health.
--
-- Reports only aggregate cron health for Veylor's weekly model-quality job.
-- No raw scans, shopper identifiers, correction values, model metrics, or cron
-- return messages are exposed. Access remains service-role-only.

create or replace function public.get_scheduled_quality_maintenance_health(
  p_now timestamptz default now(),
  p_overdue_after interval default interval '8 days'
)
returns jsonb
language sql
security definer
set search_path = public, cron
stable
as $$
  with target_job as (
    select
      j.jobid,
      j.schedule,
      j.active
    from cron.job j
    where j.jobname =
      'veylor_model_quality_maintenance_weekly'
    order by j.jobid desc
    limit 1
  ),
  latest_run as (
    select
      d.status,
      d.start_time,
      d.end_time
    from cron.job_run_details d
    join target_job j
      on j.jobid = d.jobid
    order by d.start_time desc, d.runid desc
    limit 1
  ),
  recent_failures as (
    select
      count(*)::integer as failure_count
    from cron.job_run_details d
    join target_job j
      on j.jobid = d.jobid
    where d.status = 'failed'
      and d.start_time >=
        p_now - interval '30 days'
  ),
  health as (
    select
      j.jobid,
      j.schedule,
      j.active,
      lr.status as latest_run_status,
      lr.start_time as latest_run_started_at,
      lr.end_time as latest_run_ended_at,
      rf.failure_count,
      coalesce(
        lr.end_time,
        lr.start_time
      ) as latest_run_reference_at
    from recent_failures rf
    left join target_job j
      on true
    left join latest_run lr
      on true
  )
  select jsonb_build_object(
    'checkedAt',
    p_now,
    'jobName',
    'veylor_model_quality_maintenance_weekly',
    'schedule',
    health.schedule,
    'active',
    coalesce(health.active, false),
    'status',
    case
      when health.jobid is null then
        'missing'
      when not health.active then
        'disabled'
      when health.latest_run_status = 'failed' then
        'failed'
      when health.latest_run_reference_at is null then
        'waiting_for_first_run'
      when health.latest_run_reference_at
        + p_overdue_after <= p_now then
        'overdue'
      else
        'healthy'
    end,
    'latestRunStatus',
    health.latest_run_status,
    'latestRunStartedAt',
    health.latest_run_started_at,
    'latestRunEndedAt',
    health.latest_run_ended_at,
    'failuresLast30Days',
    health.failure_count,
    'overdueAfterSeconds',
    greatest(
      floor(
        extract(epoch from p_overdue_after)
      )::bigint,
      0
    )
  )
  from health;
$$;

revoke all on function
  public.get_scheduled_quality_maintenance_health(
    timestamptz,
    interval
  )
from public, anon, authenticated;

grant execute on function
  public.get_scheduled_quality_maintenance_health(
    timestamptz,
    interval
  )
to service_role;
