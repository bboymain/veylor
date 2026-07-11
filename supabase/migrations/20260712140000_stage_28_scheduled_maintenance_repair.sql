-- Stage 28: scheduled model-quality maintenance repair and bootstrap.
--
-- Repairs only Veylor's exact weekly pg_cron job when it is missing, duplicated,
-- disabled, or misconfigured. An optional bootstrap run uses the existing
-- privacy-safe aggregate maintenance workflow and stores no raw scan data.

create or replace function public.repair_scheduled_quality_maintenance(
  p_run_bootstrap boolean default false,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, cron, pg_catalog
as $$
declare
  v_job_count integer := 0;
  v_valid_job_count integer := 0;
  v_job_id bigint;
  v_repaired boolean := false;
  v_bootstrap_ran boolean := false;
  v_maintenance_run_id uuid;
  v_snapshots_written integer := 0;
  v_regressions_detected integer := 0;
  v_run_status text;
begin
  if p_now is null then
    p_now := now();
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where j.active
        and j.schedule = '15 3 * * 1'
        and j.command ilike
          '%public.run_model_quality_maintenance%'
    )::integer
  into
    v_job_count,
    v_valid_job_count
  from cron.job j
  where j.jobname =
    'veylor_model_quality_maintenance_weekly';

  if v_job_count <> 1
     or v_valid_job_count <> 1 then
    for v_job_id in
      select j.jobid
      from cron.job j
      where j.jobname =
        'veylor_model_quality_maintenance_weekly'
    loop
      perform cron.unschedule(v_job_id);
    end loop;

    perform cron.schedule(
      'veylor_model_quality_maintenance_weekly',
      '15 3 * * 1',
      $cron$
        select *
        from public.run_model_quality_maintenance();
      $cron$
    );

    v_repaired := true;
  end if;

  if p_run_bootstrap then
    select
      result.maintenance_run_id,
      result.snapshots_written,
      result.regressions_detected,
      result.run_status
    into
      v_maintenance_run_id,
      v_snapshots_written,
      v_regressions_detected,
      v_run_status
    from public.run_model_quality_maintenance(
      p_now - interval '7 days',
      p_now,
      20,
      0.05
    ) as result
    limit 1;

    v_bootstrap_ran :=
      v_maintenance_run_id is not null;
  end if;

  return jsonb_build_object(
    'jobName',
    'veylor_model_quality_maintenance_weekly',
    'schedule',
    '15 3 * * 1',
    'repaired',
    v_repaired,
    'bootstrapRequested',
    p_run_bootstrap,
    'bootstrapRan',
    v_bootstrap_ran,
    'maintenanceRunId',
    v_maintenance_run_id,
    'snapshotsWritten',
    coalesce(v_snapshots_written, 0),
    'regressionsDetected',
    coalesce(v_regressions_detected, 0),
    'runStatus',
    v_run_status
  );
end;
$$;

revoke all on function
  public.repair_scheduled_quality_maintenance(
    boolean,
    timestamptz
  )
from public, anon, authenticated;

grant execute on function
  public.repair_scheduled_quality_maintenance(
    boolean,
    timestamptz
  )
to service_role;
