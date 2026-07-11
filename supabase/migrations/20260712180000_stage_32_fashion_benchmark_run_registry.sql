-- Stage 32: private fashion benchmark run registry.
--
-- Stores controlled benchmark execution metadata and per-case aggregate scores.
-- Access remains service-role-only behind RLS. Production scan history, shopper
-- identifiers, public uploads, benchmark image bytes, and raw model output are
-- intentionally excluded from these tables.

create table if not exists public.fashion_benchmark_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model text not null,
  status text not null default 'running',
  case_count integer not null default 0,
  completed_case_count integer not null default 0,
  failed_case_count integer not null default 0,
  average_score numeric,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.fashion_benchmark_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.fashion_benchmark_runs(id) on delete cascade,
  case_id text not null references public.fashion_benchmark_cases(case_id) on delete restrict,
  status text not null,
  category_score numeric,
  color_score numeric,
  pattern_score numeric,
  material_score numeric,
  style_score numeric,
  visible_brand_score numeric,
  overall_score numeric,
  response_time_ms integer,
  invalid_json boolean not null default false,
  hallucinated_brand boolean not null default false,
  failure_code text,
  created_at timestamptz not null default now(),
  unique (run_id, case_id)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.fashion_benchmark_runs'::regclass
      and conname = 'fashion_benchmark_runs_status_check'
  ) then
    alter table public.fashion_benchmark_runs
      add constraint fashion_benchmark_runs_status_check
      check (status in ('running', 'completed', 'failed')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.fashion_benchmark_runs'::regclass
      and conname = 'fashion_benchmark_runs_counts_check'
  ) then
    alter table public.fashion_benchmark_runs
      add constraint fashion_benchmark_runs_counts_check
      check (
        case_count >= 0
        and completed_case_count >= 0
        and failed_case_count >= 0
        and completed_case_count + failed_case_count <= case_count
        and (average_score is null or average_score between 0 and 1)
        and (completed_at is null or completed_at >= started_at)
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.fashion_benchmark_results'::regclass
      and conname = 'fashion_benchmark_results_status_check'
  ) then
    alter table public.fashion_benchmark_results
      add constraint fashion_benchmark_results_status_check
      check (status in ('completed', 'failed')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.fashion_benchmark_results'::regclass
      and conname = 'fashion_benchmark_results_scores_check'
  ) then
    alter table public.fashion_benchmark_results
      add constraint fashion_benchmark_results_scores_check
      check (
        (category_score is null or category_score between 0 and 1)
        and (color_score is null or color_score between 0 and 1)
        and (pattern_score is null or pattern_score between 0 and 1)
        and (material_score is null or material_score between 0 and 1)
        and (style_score is null or style_score between 0 and 1)
        and (visible_brand_score is null or visible_brand_score between 0 and 1)
        and (overall_score is null or overall_score between 0 and 1)
        and (response_time_ms is null or response_time_ms >= 0)
      ) not valid;
  end if;
end $$;

alter table public.fashion_benchmark_runs
  validate constraint fashion_benchmark_runs_status_check;
alter table public.fashion_benchmark_runs
  validate constraint fashion_benchmark_runs_counts_check;
alter table public.fashion_benchmark_results
  validate constraint fashion_benchmark_results_status_check;
alter table public.fashion_benchmark_results
  validate constraint fashion_benchmark_results_scores_check;

create index if not exists fashion_benchmark_runs_provider_model_started_idx
  on public.fashion_benchmark_runs (provider, model, started_at desc);
create index if not exists fashion_benchmark_results_run_idx
  on public.fashion_benchmark_results (run_id, created_at);

create or replace function public.start_fashion_benchmark_run(
  p_provider text,
  p_model text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_provider text := nullif(trim(p_provider), '');
  v_model text := nullif(trim(p_model), '');
  v_case_count integer := 0;
  v_run_id uuid;
begin
  if v_provider is null or v_model is null then
    return null;
  end if;

  select count(*)::integer
  into v_case_count
  from public.fashion_benchmark_cases
  where active = true;

  if v_case_count = 0 then
    return null;
  end if;

  insert into public.fashion_benchmark_runs (
    provider, model, status, case_count
  ) values (
    v_provider, v_model, 'running', v_case_count
  ) returning id into v_run_id;

  return v_run_id;
end;
$$;

create or replace function public.record_fashion_benchmark_result(
  p_run_id uuid,
  p_case_id text,
  p_status text,
  p_category_score numeric default null,
  p_color_score numeric default null,
  p_pattern_score numeric default null,
  p_material_score numeric default null,
  p_style_score numeric default null,
  p_visible_brand_score numeric default null,
  p_overall_score numeric default null,
  p_response_time_ms integer default null,
  p_invalid_json boolean default false,
  p_hallucinated_brand boolean default false,
  p_failure_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_status text := lower(trim(p_status));
  v_case_id text := lower(trim(p_case_id));
  v_failure_code text := nullif(trim(p_failure_code), '');
begin
  if p_run_id is null
     or v_case_id is null
     or v_status not in ('completed', 'failed')
     or p_invalid_json is null
     or p_hallucinated_brand is null
     or (p_response_time_ms is not null and p_response_time_ms < 0)
     or exists (
       select 1
       from unnest(array[
         p_category_score,
         p_color_score,
         p_pattern_score,
         p_material_score,
         p_style_score,
         p_visible_brand_score,
         p_overall_score
       ]) as score
       where score is not null and (score < 0 or score > 1)
     ) then
    return false;
  end if;

  if not exists (
    select 1 from public.fashion_benchmark_runs
    where id = p_run_id and status = 'running'
  ) or not exists (
    select 1 from public.fashion_benchmark_cases
    where case_id = v_case_id and active = true
  ) then
    return false;
  end if;

  insert into public.fashion_benchmark_results (
    run_id, case_id, status, category_score, color_score, pattern_score,
    material_score, style_score, visible_brand_score, overall_score,
    response_time_ms, invalid_json, hallucinated_brand, failure_code
  ) values (
    p_run_id, v_case_id, v_status, p_category_score, p_color_score,
    p_pattern_score, p_material_score, p_style_score,
    p_visible_brand_score, p_overall_score, p_response_time_ms,
    p_invalid_json, p_hallucinated_brand, v_failure_code
  )
  on conflict (run_id, case_id) do update
  set status = excluded.status,
      category_score = excluded.category_score,
      color_score = excluded.color_score,
      pattern_score = excluded.pattern_score,
      material_score = excluded.material_score,
      style_score = excluded.style_score,
      visible_brand_score = excluded.visible_brand_score,
      overall_score = excluded.overall_score,
      response_time_ms = excluded.response_time_ms,
      invalid_json = excluded.invalid_json,
      hallucinated_brand = excluded.hallucinated_brand,
      failure_code = excluded.failure_code,
      created_at = now();

  return true;
end;
$$;

create or replace function public.complete_fashion_benchmark_run(
  p_run_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_completed integer;
  v_failed integer;
  v_average numeric;
  v_case_count integer;
begin
  if p_run_id is null then
    return false;
  end if;

  select case_count
  into v_case_count
  from public.fashion_benchmark_runs
  where id = p_run_id and status = 'running'
  for update;

  if not found then
    return false;
  end if;

  select
    count(*) filter (where status = 'completed')::integer,
    count(*) filter (where status = 'failed')::integer,
    avg(overall_score) filter (where status = 'completed')
  into v_completed, v_failed, v_average
  from public.fashion_benchmark_results
  where run_id = p_run_id;

  update public.fashion_benchmark_runs
  set status = case
        when coalesce(v_completed, 0) + coalesce(v_failed, 0) = 0
          then 'failed'
        else 'completed'
      end,
      completed_case_count = coalesce(v_completed, 0),
      failed_case_count = coalesce(v_failed, 0),
      average_score = v_average,
      completed_at = now()
  where id = p_run_id;

  return true;
end;
$$;

revoke all on table public.fashion_benchmark_runs
  from public, anon, authenticated;
revoke all on table public.fashion_benchmark_results
  from public, anon, authenticated;
revoke all on function public.start_fashion_benchmark_run(text, text)
  from public, anon, authenticated;
revoke all on function public.record_fashion_benchmark_result(
  uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, integer, boolean, boolean, text
) from public, anon, authenticated;
revoke all on function public.complete_fashion_benchmark_run(uuid)
  from public, anon, authenticated;

grant select, insert, update, delete on table public.fashion_benchmark_runs
  to service_role;
grant select, insert, update, delete on table public.fashion_benchmark_results
  to service_role;
grant execute on function public.start_fashion_benchmark_run(text, text)
  to service_role;
grant execute on function public.record_fashion_benchmark_result(
  uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, integer, boolean, boolean, text
) to service_role;
grant execute on function public.complete_fashion_benchmark_run(uuid)
  to service_role;

alter table public.fashion_benchmark_runs enable row level security;
alter table public.fashion_benchmark_results enable row level security;
