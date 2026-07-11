-- Stage 33: privacy-safe fashion benchmark reporting.
--
-- Produces aggregate run and model comparison reports only. Benchmark image
-- paths, expected labels, case IDs, raw model output, shopper data, and
-- production scan rows are never returned. Access remains service-role-only.

create or replace function public.get_fashion_benchmark_run_summary(
  p_run_id uuid
)
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
stable
as $$
  with target_run as (
    select
      r.id,
      r.provider,
      r.model,
      r.status,
      r.case_count,
      r.completed_case_count,
      r.failed_case_count,
      r.average_score,
      r.started_at,
      r.completed_at
    from public.fashion_benchmark_runs r
    where r.id = p_run_id
  ),
  result_summary as (
    select
      count(*)::integer as recorded_cases,
      count(*) filter (where br.status = 'completed')::integer
        as successful_cases,
      count(*) filter (where br.status = 'failed')::integer
        as failed_cases,
      round(avg(br.category_score), 4) as category_score,
      round(avg(br.color_score), 4) as color_score,
      round(avg(br.pattern_score), 4) as pattern_score,
      round(avg(br.material_score), 4) as material_score,
      round(avg(br.style_score), 4) as style_score,
      round(avg(br.visible_brand_score), 4) as visible_brand_score,
      round(avg(br.overall_score), 4) as overall_score,
      round(avg(br.response_time_ms), 2) as average_response_time_ms,
      count(*) filter (where br.invalid_json)::integer
        as invalid_json_count,
      count(*) filter (where br.hallucinated_brand)::integer
        as hallucinated_brand_count
    from public.fashion_benchmark_results br
    where br.run_id = p_run_id
  )
  select case
    when tr.id is null then null
    else jsonb_build_object(
      'runId', tr.id,
      'provider', tr.provider,
      'model', tr.model,
      'status', tr.status,
      'startedAt', tr.started_at,
      'completedAt', tr.completed_at,
      'expectedCases', tr.case_count,
      'recordedCases', rs.recorded_cases,
      'successfulCases', rs.successful_cases,
      'failedCases', rs.failed_cases,
      'completionRate', round(
        rs.recorded_cases::numeric / nullif(tr.case_count, 0),
        4
      ),
      'scores', jsonb_build_object(
        'category', rs.category_score,
        'color', rs.color_score,
        'pattern', rs.pattern_score,
        'material', rs.material_score,
        'style', rs.style_score,
        'visibleBrand', rs.visible_brand_score,
        'overall', coalesce(rs.overall_score, tr.average_score)
      ),
      'averageResponseTimeMs', rs.average_response_time_ms,
      'invalidJsonCount', rs.invalid_json_count,
      'hallucinatedBrandCount', rs.hallucinated_brand_count
    )
  end
  from target_run tr
  cross join result_summary rs;
$$;

create or replace function public.compare_fashion_benchmark_models(
  p_since timestamptz default (now() - interval '180 days'),
  p_minimum_completed_cases integer default 1
)
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
stable
as $$
  with eligible_results as (
    select
      r.provider,
      r.model,
      r.id as run_id,
      br.category_score,
      br.color_score,
      br.pattern_score,
      br.material_score,
      br.style_score,
      br.visible_brand_score,
      br.overall_score,
      br.response_time_ms,
      br.invalid_json,
      br.hallucinated_brand,
      br.status
    from public.fashion_benchmark_runs r
    join public.fashion_benchmark_results br
      on br.run_id = r.id
    where r.status = 'completed'
      and r.completed_at >= coalesce(
        p_since,
        '-infinity'::timestamptz
      )
  ),
  model_summary as (
    select
      er.provider,
      er.model,
      count(distinct er.run_id)::integer as run_count,
      count(*)::integer as recorded_cases,
      count(*) filter (where er.status = 'completed')::integer
        as completed_cases,
      count(*) filter (where er.status = 'failed')::integer
        as failed_cases,
      round(avg(er.category_score), 4) as category_score,
      round(avg(er.color_score), 4) as color_score,
      round(avg(er.pattern_score), 4) as pattern_score,
      round(avg(er.material_score), 4) as material_score,
      round(avg(er.style_score), 4) as style_score,
      round(avg(er.visible_brand_score), 4) as visible_brand_score,
      round(avg(er.overall_score), 4) as overall_score,
      round(avg(er.response_time_ms), 2) as average_response_time_ms,
      count(*) filter (where er.invalid_json)::integer
        as invalid_json_count,
      count(*) filter (where er.hallucinated_brand)::integer
        as hallucinated_brand_count
    from eligible_results er
    group by er.provider, er.model
    having count(*) filter (
      where er.status = 'completed'
    ) >= greatest(p_minimum_completed_cases, 1)
  )
  select jsonb_build_object(
    'since', p_since,
    'minimumCompletedCases', greatest(p_minimum_completed_cases, 1),
    'models', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'provider', ms.provider,
          'model', ms.model,
          'runCount', ms.run_count,
          'recordedCases', ms.recorded_cases,
          'completedCases', ms.completed_cases,
          'failedCases', ms.failed_cases,
          'successRate', round(
            ms.completed_cases::numeric
            / nullif(ms.recorded_cases, 0),
            4
          ),
          'scores', jsonb_build_object(
            'category', ms.category_score,
            'color', ms.color_score,
            'pattern', ms.pattern_score,
            'material', ms.material_score,
            'style', ms.style_score,
            'visibleBrand', ms.visible_brand_score,
            'overall', ms.overall_score
          ),
          'averageResponseTimeMs', ms.average_response_time_ms,
          'invalidJsonCount', ms.invalid_json_count,
          'hallucinatedBrandCount', ms.hallucinated_brand_count
        )
        order by
          ms.overall_score desc nulls last,
          ms.completed_cases desc,
          ms.provider asc,
          ms.model asc
      ),
      '[]'::jsonb
    )
  )
  from model_summary ms;
$$;

revoke all on function public.get_fashion_benchmark_run_summary(uuid)
  from public, anon, authenticated;

revoke all on function public.compare_fashion_benchmark_models(
  timestamptz,
  integer
) from public, anon, authenticated;

grant execute on function public.get_fashion_benchmark_run_summary(uuid)
  to service_role;

grant execute on function public.compare_fashion_benchmark_models(
  timestamptz,
  integer
) to service_role;

alter table public.fashion_benchmark_runs enable row level security;
alter table public.fashion_benchmark_results enable row level security;
alter table public.fashion_benchmark_cases enable row level security;
