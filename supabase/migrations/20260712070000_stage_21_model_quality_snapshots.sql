-- Stage 21: privacy-safe model quality snapshots.
--
-- Stores aggregate correction metrics only. No shopper identifiers, raw scan
-- payloads, item text, correction values, image hashes, or individual scan IDs
-- are copied into this table.

create table if not exists public.model_quality_snapshots (
  id uuid primary key default gen_random_uuid(),
  model text not null,
  period_started_at timestamptz not null,
  period_ended_at timestamptz not null,
  total_scans integer not null,
  corrected_scans integer not null,
  total_corrections integer not null,
  correction_rate numeric not null,
  average_corrections_per_corrected_scan numeric,
  sample_usable boolean not null,
  created_at timestamptz not null default now(),
  unique (model, period_started_at, period_ended_at)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.model_quality_snapshots'::regclass
      and conname = 'model_quality_snapshots_counts_check'
  ) then
    alter table public.model_quality_snapshots
      add constraint model_quality_snapshots_counts_check
      check (
        total_scans >= 0
        and corrected_scans >= 0
        and total_corrections >= 0
        and corrected_scans <= total_scans
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.model_quality_snapshots'::regclass
      and conname = 'model_quality_snapshots_period_check'
  ) then
    alter table public.model_quality_snapshots
      add constraint model_quality_snapshots_period_check
      check (period_ended_at > period_started_at) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.model_quality_snapshots'::regclass
      and conname = 'model_quality_snapshots_rate_check'
  ) then
    alter table public.model_quality_snapshots
      add constraint model_quality_snapshots_rate_check
      check (correction_rate >= 0 and correction_rate <= 1) not valid;
  end if;
end $$;

alter table public.model_quality_snapshots
  validate constraint model_quality_snapshots_counts_check;
alter table public.model_quality_snapshots
  validate constraint model_quality_snapshots_period_check;
alter table public.model_quality_snapshots
  validate constraint model_quality_snapshots_rate_check;

create index if not exists model_quality_snapshots_model_period_idx
  on public.model_quality_snapshots (model, period_ended_at desc);

create or replace function public.capture_model_quality_snapshot(
  p_period_started_at timestamptz,
  p_period_ended_at timestamptz default now(),
  p_minimum_sample_size integer default 20
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  if p_period_started_at is null
     or p_period_ended_at is null
     or p_period_ended_at <= p_period_started_at
     or p_minimum_sample_size < 1 then
    return 0;
  end if;

  insert into public.model_quality_snapshots (
    model,
    period_started_at,
    period_ended_at,
    total_scans,
    corrected_scans,
    total_corrections,
    correction_rate,
    average_corrections_per_corrected_scan,
    sample_usable
  )
  select
    coalesce(nullif(trim(s.model), ''), 'unknown') as model,
    p_period_started_at,
    p_period_ended_at,
    count(*)::integer,
    count(*) filter (where s.correction_count > 0)::integer,
    coalesce(sum(s.correction_count), 0)::integer,
    coalesce(
      count(*) filter (where s.correction_count > 0)::numeric
      / nullif(count(*), 0),
      0
    ),
    case
      when count(*) filter (where s.correction_count > 0) > 0 then
        coalesce(sum(s.correction_count), 0)::numeric
        / count(*) filter (where s.correction_count > 0)
      else null
    end,
    count(*) >= p_minimum_sample_size
  from public.searches s
  where s.search_type = 'scan'
    and s.status = 'success'
    and s.created_at >= p_period_started_at
    and s.created_at < p_period_ended_at
  group by coalesce(nullif(trim(s.model), ''), 'unknown')
  on conflict (model, period_started_at, period_ended_at) do update
  set
    total_scans = excluded.total_scans,
    corrected_scans = excluded.corrected_scans,
    total_corrections = excluded.total_corrections,
    correction_rate = excluded.correction_rate,
    average_corrections_per_corrected_scan =
      excluded.average_corrections_per_corrected_scan,
    sample_usable = excluded.sample_usable,
    created_at = now();

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.get_model_quality_trends(
  p_since timestamptz default (now() - interval '90 days'),
  p_only_usable boolean default true
)
returns table (
  model text,
  period_started_at timestamptz,
  period_ended_at timestamptz,
  total_scans integer,
  corrected_scans integer,
  total_corrections integer,
  correction_rate numeric,
  average_corrections_per_corrected_scan numeric,
  sample_usable boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    mqs.model,
    mqs.period_started_at,
    mqs.period_ended_at,
    mqs.total_scans,
    mqs.corrected_scans,
    mqs.total_corrections,
    mqs.correction_rate,
    mqs.average_corrections_per_corrected_scan,
    mqs.sample_usable
  from public.model_quality_snapshots mqs
  where mqs.period_ended_at >= coalesce(p_since, '-infinity'::timestamptz)
    and (not p_only_usable or mqs.sample_usable)
  order by mqs.period_ended_at desc, mqs.model asc;
$$;

revoke all on function public.capture_model_quality_snapshot(
  timestamptz,
  timestamptz,
  integer
) from public, anon, authenticated;

revoke all on function public.get_model_quality_trends(
  timestamptz,
  boolean
) from public, anon, authenticated;

grant execute on function public.capture_model_quality_snapshot(
  timestamptz,
  timestamptz,
  integer
) to service_role;

grant execute on function public.get_model_quality_trends(
  timestamptz,
  boolean
) to service_role;

alter table public.model_quality_snapshots enable row level security;
alter table public.searches enable row level security;
