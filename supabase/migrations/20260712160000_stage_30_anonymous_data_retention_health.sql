-- Stage 30: privacy-safe anonymous data retention health.
--
-- Reports aggregate health for Veylor's daily anonymous-data cleanup job and
-- latest retention run. No shopper identifiers, profile contents, quota keys,
-- scan payloads, correction values, item text, or images are exposed.

create or replace function public.get_anonymous_data_retention_health(
  p_now timestamptz default now(),
  p_overdue_after interval default interval '2 days'
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
      'veylor_anonymous_data_retention_daily'
    order by j.jobid desc
    limit 1
  ),
  latest_cron_run as (
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
  recent_cron_failures as (
    select
      count(*)::integer as failure_count
    from cron.job_run_details d
    join target_job j
      on j.jobid = d.jobid
    where d.status = 'failed'
      and d.start_time >=
        p_now - interval '30 days'
  ),
  latest_retention_run as (
    select
      r.quota_windows_deleted,
      r.shopper_profiles_deleted,
      r.quota_retention_seconds,
      r.profile_retention_seconds,
      r.started_at,
      r.completed_at
    from public.anonymous_data_retention_runs r
    order by r.completed_at desc, r.id desc
    limit 1
  ),
  health as (
    select
      j.jobid,
      j.schedule,
      j.active,
      cr.status as latest_cron_status,
      cr.start_time as latest_cron_started_at,
      cr.end_time as latest_cron_ended_at,
      cf.failure_count,
      rr.quota_windows_deleted,
      rr.shopper_profiles_deleted,
      rr.quota_retention_seconds,
      rr.profile_retention_seconds,
      rr.started_at as latest_retention_started_at,
      rr.completed_at as latest_retention_completed_at
    from recent_cron_failures cf
    left join target_job j
      on true
    left join latest_cron_run cr
      on true
    left join latest_retention_run rr
      on true
  )
  select jsonb_build_object(
    'checkedAt', p_now,
    'jobName',
      'veylor_anonymous_data_retention_daily',
    'schedule', health.schedule,
    'active', coalesce(health.active, false),
    'status',
      case
        when health.jobid is null then
          'missing'
        when not health.active then
          'disabled'
        when health.latest_cron_status = 'failed' then
          'failed'
        when health.latest_retention_completed_at is null then
          'waiting_for_first_cron_run'
        when health.latest_retention_completed_at
          + p_overdue_after <= p_now then
          'overdue'
        when health.latest_cron_status is null then
          'waiting_for_first_cron_run'
        else
          'healthy'
      end,
    'latestCronStatus',
      health.latest_cron_status,
    'latestCronStartedAt',
      health.latest_cron_started_at,
    'latestCronEndedAt',
      health.latest_cron_ended_at,
    'cronFailuresLast30Days',
      health.failure_count,
    'latestRetentionRun',
      case
        when health.latest_retention_completed_at is null then
          null
        else
          jsonb_build_object(
            'quotaWindowsDeleted',
              health.quota_windows_deleted,
            'shopperProfilesDeleted',
              health.shopper_profiles_deleted,
            'quotaRetentionSeconds',
              health.quota_retention_seconds,
            'profileRetentionSeconds',
              health.profile_retention_seconds,
            'startedAt',
              health.latest_retention_started_at,
            'completedAt',
              health.latest_retention_completed_at
          )
      end,
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
  public.get_anonymous_data_retention_health(
    timestamptz,
    interval
  )
from public, anon, authenticated;

grant execute on function
  public.get_anonymous_data_retention_health(
    timestamptz,
    interval
  )
to service_role;

alter table public.anonymous_data_retention_runs
  enable row level security;
