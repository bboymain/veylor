-- Stage 23: one-call model quality maintenance.
--
-- Captures aggregate model-quality snapshots and immediately checks them for
-- regressions. Run records contain aggregate counts and time windows only; no
-- shopper identifiers, scan payloads, item text, correction values, or images.

create table if not exists public.model_quality_maintenance_runs (
  id uuid primary key default gen_random_uuid(),
  period_started_at timestamptz not null,
  period_ended_at timestamptz not null,
  minimum_sample_size integer not null,
  regression_threshold numeric not null,
  snapshots_written integer not null default 0,
  regressions_detected integer not null default 0,
  status text not null default 'completed',
  created_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  unique (period_started_at, period_ended_at)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.model_quality_maintenance_runs'::regclass
      and conname = 'model_quality_maintenance_runs_period_check'
  ) then
    alter table public.model_quality_maintenance_runs
      add constraint model_quality_maintenance_runs_period_check
      check (period_ended_at > period_started_at) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.model_quality_maintenance_runs'::regclass
      and conname = 'model_quality_maintenance_runs_settings_check'
  ) then
    alter table public.model_quality_maintenance_runs
      add constraint model_quality_maintenance_runs_settings_check
      check (
        minimum_sample_size >= 1
        and regression_threshold > 0
        and regression_threshold <= 1
        and snapshots_written >= 0
        and regressions_detected >= 0
        and status in ('completed', 'skipped')
      ) not valid;
  end if;
end $$;

alter table public.model_quality_maintenance_runs
  validate constraint model_quality_maintenance_runs_period_check;

alter table public.model_quality_maintenance_runs
  validate constraint model_quality_maintenance_runs_settings_check;

create index if not exists model_quality_maintenance_runs_completed_idx
  on public.model_quality_maintenance_runs (completed_at desc);

create or replace function public.run_model_quality_maintenance(
  p_period_started_at timestamptz default (now() - interval '7 days'),
  p_period_ended_at timestamptz default now(),
  p_minimum_sample_size integer default 20,
  p_regression_threshold numeric default 0.05
)
returns table (
  maintenance_run_id uuid,
  snapshots_written integer,
  regressions_detected integer,
  run_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_snapshots integer := 0;
  v_regressions integer := 0;
  v_lock_acquired boolean;
begin
  if p_period_started_at is null
     or p_period_ended_at is null
     or p_period_ended_at <= p_period_started_at
     or p_minimum_sample_size < 1
     or p_regression_threshold <= 0
     or p_regression_threshold > 1 then
    return;
  end if;

  v_lock_acquired := pg_try_advisory_xact_lock(
    hashtext('veylor:model-quality-maintenance')::bigint
  );

  if not v_lock_acquired then
    insert into public.model_quality_maintenance_runs (
      period_started_at,
      period_ended_at,
      minimum_sample_size,
      regression_threshold,
      snapshots_written,
      regressions_detected,
      status,
      completed_at
    ) values (
      p_period_started_at,
      p_period_ended_at,
      p_minimum_sample_size,
      p_regression_threshold,
      0,
      0,
      'skipped',
      now()
    )
    on conflict (period_started_at, period_ended_at) do update
    set
      minimum_sample_size = excluded.minimum_sample_size,
      regression_threshold = excluded.regression_threshold,
      status = 'skipped',
      completed_at = now()
    returning id into v_run_id;

    return query select v_run_id, 0, 0, 'skipped'::text;
    return;
  end if;

  select public.capture_model_quality_snapshot(
    p_period_started_at,
    p_period_ended_at,
    p_minimum_sample_size
  ) into v_snapshots;

  select public.detect_model_quality_regressions(
    p_period_started_at - interval '180 days',
    p_regression_threshold
  ) into v_regressions;

  insert into public.model_quality_maintenance_runs (
    period_started_at,
    period_ended_at,
    minimum_sample_size,
    regression_threshold,
    snapshots_written,
    regressions_detected,
    status,
    completed_at
  ) values (
    p_period_started_at,
    p_period_ended_at,
    p_minimum_sample_size,
    p_regression_threshold,
    coalesce(v_snapshots, 0),
    coalesce(v_regressions, 0),
    'completed',
    now()
  )
  on conflict (period_started_at, period_ended_at) do update
  set
    minimum_sample_size = excluded.minimum_sample_size,
    regression_threshold = excluded.regression_threshold,
    snapshots_written = excluded.snapshots_written,
    regressions_detected = excluded.regressions_detected,
    status = 'completed',
    completed_at = now()
  returning id into v_run_id;

  return query
  select
    v_run_id,
    coalesce(v_snapshots, 0),
    coalesce(v_regressions, 0),
    'completed'::text;
end;
$$;

revoke all on function public.run_model_quality_maintenance(
  timestamptz,
  timestamptz,
  integer,
  numeric
) from public, anon, authenticated;

grant execute on function public.run_model_quality_maintenance(
  timestamptz,
  timestamptz,
  integer,
  numeric
) to service_role;

alter table public.model_quality_maintenance_runs enable row level security;
alter table public.model_quality_snapshots enable row level security;
alter table public.model_quality_regressions enable row level security;