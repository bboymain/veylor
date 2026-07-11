-- Stage 26: scheduled model quality maintenance.
--
-- Runs the existing aggregate maintenance workflow once per week inside
-- Supabase. The job stores only the privacy-safe aggregate snapshots, alerts,
-- and maintenance-run records introduced in Stages 21 through 24.

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
end;
$$;
