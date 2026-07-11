-- Stage 29: automatic retention for anonymous operational data.
--
-- Removes expired quota windows and long-inactive anonymous preference profiles.
-- Retention logs contain aggregate deletion counts only and never copy shopper
-- identifiers, preference values, scan payloads, correction text, or images.

create table if not exists public.anonymous_data_retention_runs (
  id uuid primary key default gen_random_uuid(),
  quota_windows_deleted integer not null default 0,
  shopper_profiles_deleted integer not null default 0,
  quota_retention_seconds bigint not null,
  profile_retention_seconds bigint not null,
  started_at timestamptz not null,
  completed_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid =
      'public.anonymous_data_retention_runs'::regclass
      and conname =
        'anonymous_data_retention_runs_counts_check'
  ) then
    alter table public.anonymous_data_retention_runs
      add constraint
        anonymous_data_retention_runs_counts_check
      check (
        quota_windows_deleted >= 0
        and shopper_profiles_deleted >= 0
        and quota_retention_seconds > 0
        and profile_retention_seconds > 0
        and completed_at >= started_at
      ) not valid;
  end if;
end $$;

alter table public.anonymous_data_retention_runs
  validate constraint
    anonymous_data_retention_runs_counts_check;

create index if not exists
  anonymous_data_retention_runs_completed_idx
on public.anonymous_data_retention_runs (
  completed_at desc
);

create or replace function public.run_anonymous_data_retention(
  p_now timestamptz default now(),
  p_quota_retention interval default interval '2 days',
  p_profile_retention interval default interval '180 days'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_started_at timestamptz;
  v_quota_deleted integer := 0;
  v_profiles_deleted integer := 0;
  v_run_id uuid;
  v_quota_seconds bigint;
  v_profile_seconds bigint;
begin
  if p_now is null
     or p_quota_retention <= interval '0 seconds'
     or p_profile_retention <= interval '0 seconds' then
    return jsonb_build_object(
      'status', 'invalid_settings',
      'quotaWindowsDeleted', 0,
      'shopperProfilesDeleted', 0
    );
  end if;

  v_started_at := clock_timestamp();
  v_quota_seconds :=
    floor(extract(epoch from p_quota_retention))::bigint;
  v_profile_seconds :=
    floor(extract(epoch from p_profile_retention))::bigint;

  delete from public.api_quota_windows
  where updated_at < p_now - p_quota_retention;

  get diagnostics v_quota_deleted = row_count;

  delete from public.shopper_profiles
  where updated_at < p_now - p_profile_retention;

  get diagnostics v_profiles_deleted = row_count;

  insert into public.anonymous_data_retention_runs (
    quota_windows_deleted,
    shopper_profiles_deleted,
    quota_retention_seconds,
    profile_retention_seconds,
    started_at,
    completed_at
  ) values (
    v_quota_deleted,
    v_profiles_deleted,
    v_quota_seconds,
    v_profile_seconds,
    v_started_at,
    clock_timestamp()
  )
  returning id into v_run_id;

  return jsonb_build_object(
    'status', 'completed',
    'retentionRunId', v_run_id,
    'quotaWindowsDeleted', v_quota_deleted,
    'shopperProfilesDeleted', v_profiles_deleted,
    'quotaRetentionSeconds', v_quota_seconds,
    'profileRetentionSeconds', v_profile_seconds
  );
end;
$$;

revoke all on function public.run_anonymous_data_retention(
  timestamptz,
  interval,
  interval
) from public, anon, authenticated;

grant execute on function public.run_anonymous_data_retention(
  timestamptz,
  interval,
  interval
) to service_role;

alter table public.anonymous_data_retention_runs
  enable row level security;

alter table public.api_quota_windows
  enable row level security;

alter table public.shopper_profiles
  enable row level security;

create extension if not exists pg_cron
  with schema pg_catalog;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid
    from cron.job
    where jobname =
      'veylor_anonymous_data_retention_daily'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'veylor_anonymous_data_retention_daily',
    '20 4 * * *',
    $cron$
      select public.run_anonymous_data_retention();
    $cron$
  );
end;
$$;
