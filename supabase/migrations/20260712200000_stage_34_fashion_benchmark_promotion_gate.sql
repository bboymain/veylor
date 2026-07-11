-- Stage 34: private fashion benchmark model promotion gate.
--
-- Records one approved benchmark baseline and evaluates completed candidate runs
-- against it. This never changes Veylor's production model automatically.

create table if not exists public.fashion_benchmark_baselines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references public.fashion_benchmark_runs(id) on delete restrict,
  provider text not null,
  model text not null,
  approved_at timestamptz not null default now(),
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  check (retired_at is null or retired_at >= approved_at)
);

create unique index if not exists fashion_benchmark_one_active_baseline_idx
  on public.fashion_benchmark_baselines ((retired_at is null))
  where retired_at is null;

create or replace function public.set_fashion_benchmark_baseline(
  p_run_id uuid,
  p_approved_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_provider text;
  v_model text;
begin
  if p_run_id is null or p_approved_at is null then
    return false;
  end if;

  select provider, model
    into v_provider, v_model
  from public.fashion_benchmark_runs
  where id = p_run_id
    and status = 'completed'
    and completed_case_count > 0;

  if not found then
    return false;
  end if;

  update public.fashion_benchmark_baselines
  set retired_at = p_approved_at
  where retired_at is null;

  insert into public.fashion_benchmark_baselines (
    run_id, provider, model, approved_at
  ) values (
    p_run_id, v_provider, v_model, p_approved_at
  );

  return true;
end;
$$;

create or replace function public.evaluate_fashion_benchmark_promotion(
  p_candidate_run_id uuid,
  p_minimum_completed_cases integer default 20,
  p_minimum_score_improvement numeric default 0.02,
  p_maximum_latency_regression_ratio numeric default 0.25,
  p_maximum_invalid_json_rate numeric default 0.02,
  p_maximum_brand_hallucination_rate numeric default 0.02
)
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
stable
as $$
  with active_baseline as (
    select b.run_id
    from public.fashion_benchmark_baselines b
    where b.retired_at is null
    order by b.approved_at desc
    limit 1
  ),
  candidate as (
    select
      r.id,
      r.provider,
      r.model,
      r.status,
      r.completed_case_count,
      round(avg(br.overall_score), 4) as overall_score,
      round(avg(br.response_time_ms), 2) as average_latency_ms,
      count(*) filter (where br.invalid_json)::numeric
        / nullif(count(*), 0) as invalid_json_rate,
      count(*) filter (where br.hallucinated_brand)::numeric
        / nullif(count(*), 0) as brand_hallucination_rate
    from public.fashion_benchmark_runs r
    left join public.fashion_benchmark_results br on br.run_id = r.id
    where r.id = p_candidate_run_id
    group by r.id
  ),
  baseline as (
    select
      r.id,
      r.provider,
      r.model,
      r.completed_case_count,
      round(avg(br.overall_score), 4) as overall_score,
      round(avg(br.response_time_ms), 2) as average_latency_ms,
      count(*) filter (where br.invalid_json)::numeric
        / nullif(count(*), 0) as invalid_json_rate,
      count(*) filter (where br.hallucinated_brand)::numeric
        / nullif(count(*), 0) as brand_hallucination_rate
    from active_baseline ab
    join public.fashion_benchmark_runs r on r.id = ab.run_id
    left join public.fashion_benchmark_results br on br.run_id = r.id
    group by r.id
  )
  select jsonb_build_object(
    'decision',
      case
        when c.id is null or b.id is null then 'insufficient_data'
        when c.status <> 'completed' then 'insufficient_data'
        when c.completed_case_count < greatest(p_minimum_completed_cases, 1)
          or b.completed_case_count < greatest(p_minimum_completed_cases, 1)
          then 'insufficient_data'
        when c.overall_score is null or b.overall_score is null then 'insufficient_data'
        when c.overall_score - b.overall_score < p_minimum_score_improvement then 'hold'
        when c.average_latency_ms > b.average_latency_ms * (1 + p_maximum_latency_regression_ratio) then 'hold'
        when coalesce(c.invalid_json_rate, 0) > p_maximum_invalid_json_rate then 'hold'
        when coalesce(c.brand_hallucination_rate, 0) > p_maximum_brand_hallucination_rate then 'hold'
        else 'promote'
      end,
    'candidate', jsonb_build_object(
      'runId', c.id,
      'provider', c.provider,
      'model', c.model,
      'completedCases', c.completed_case_count,
      'overallScore', c.overall_score,
      'averageLatencyMs', c.average_latency_ms,
      'invalidJsonRate', round(coalesce(c.invalid_json_rate, 0), 4),
      'brandHallucinationRate', round(coalesce(c.brand_hallucination_rate, 0), 4)
    ),
    'baseline', jsonb_build_object(
      'runId', b.id,
      'provider', b.provider,
      'model', b.model,
      'completedCases', b.completed_case_count,
      'overallScore', b.overall_score,
      'averageLatencyMs', b.average_latency_ms,
      'invalidJsonRate', round(coalesce(b.invalid_json_rate, 0), 4),
      'brandHallucinationRate', round(coalesce(b.brand_hallucination_rate, 0), 4)
    ),
    'thresholds', jsonb_build_object(
      'minimumCompletedCases', greatest(p_minimum_completed_cases, 1),
      'minimumScoreImprovement', p_minimum_score_improvement,
      'maximumLatencyRegressionRatio', p_maximum_latency_regression_ratio,
      'maximumInvalidJsonRate', p_maximum_invalid_json_rate,
      'maximumBrandHallucinationRate', p_maximum_brand_hallucination_rate
    ),
    'productionModelChanged', false
  )
  from candidate c
  full join baseline b on true;
$$;

revoke all on table public.fashion_benchmark_baselines
  from public, anon, authenticated;
revoke all on function public.set_fashion_benchmark_baseline(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.evaluate_fashion_benchmark_promotion(
  uuid, integer, numeric, numeric, numeric, numeric
) from public, anon, authenticated;

grant select, insert, update on table public.fashion_benchmark_baselines
  to service_role;
grant execute on function public.set_fashion_benchmark_baseline(uuid, timestamptz)
  to service_role;
grant execute on function public.evaluate_fashion_benchmark_promotion(
  uuid, integer, numeric, numeric, numeric, numeric
) to service_role;

alter table public.fashion_benchmark_baselines enable row level security;
alter table public.fashion_benchmark_runs enable row level security;
alter table public.fashion_benchmark_results enable row level security;