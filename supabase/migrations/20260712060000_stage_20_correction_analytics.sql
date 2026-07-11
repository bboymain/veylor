-- Stage 20: privacy-safe aggregate scan-correction analytics.
--
-- Returns model- and field-level aggregates only. No shopper identifiers,
-- detected-item text, correction values, image data, or individual scan rows
-- are exposed. The function remains service-role-only behind RLS.

create or replace function public.get_scan_correction_analytics(
  p_since timestamptz default (now() - interval '30 days')
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with eligible_scans as (
    select
      s.id,
      coalesce(nullif(trim(s.model), ''), 'unknown') as model,
      s.correction_count
    from public.searches s
    where s.search_type = 'scan'
      and s.status = 'success'
      and s.created_at >= coalesce(p_since, '-infinity'::timestamptz)
  ),
  model_summary as (
    select
      es.model,
      count(*)::bigint as total_scans,
      count(*) filter (where es.correction_count > 0)::bigint as corrected_scans,
      coalesce(sum(es.correction_count), 0)::bigint as total_corrections,
      round(
        count(*) filter (where es.correction_count > 0)::numeric
        / nullif(count(*), 0),
        4
      ) as correction_rate,
      round(
        coalesce(sum(es.correction_count), 0)::numeric
        / nullif(count(*) filter (where es.correction_count > 0), 0),
        2
      ) as average_corrections_per_corrected_scan
    from eligible_scans es
    group by es.model
  ),
  field_summary as (
    select
      sc.field_name,
      count(*)::bigint as correction_count
    from public.scan_corrections sc
    join eligible_scans es on es.id = sc.search_id
    group by sc.field_name
  ),
  totals as (
    select
      count(*)::bigint as total_scans,
      count(*) filter (where correction_count > 0)::bigint as corrected_scans,
      coalesce(sum(correction_count), 0)::bigint as total_corrections
    from eligible_scans
  )
  select jsonb_build_object(
    'since', p_since,
    'totals', jsonb_build_object(
      'totalScans', totals.total_scans,
      'correctedScans', totals.corrected_scans,
      'totalCorrections', totals.total_corrections,
      'correctionRate', round(
        totals.corrected_scans::numeric / nullif(totals.total_scans, 0),
        4
      ),
      'averageCorrectionsPerCorrectedScan', round(
        totals.total_corrections::numeric / nullif(totals.corrected_scans, 0),
        2
      )
    ),
    'models', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'model', ms.model,
            'totalScans', ms.total_scans,
            'correctedScans', ms.corrected_scans,
            'totalCorrections', ms.total_corrections,
            'correctionRate', ms.correction_rate,
            'averageCorrectionsPerCorrectedScan',
              ms.average_corrections_per_corrected_scan
          )
          order by ms.total_scans desc, ms.model asc
        )
        from model_summary ms
      ),
      '[]'::jsonb
    ),
    'fields', coalesce(
      (
        select jsonb_object_agg(
          fs.field_name,
          fs.correction_count
          order by fs.field_name
        )
        from field_summary fs
      ),
      '{}'::jsonb
    )
  )
  from totals;
$$;

revoke all on function public.get_scan_correction_analytics(timestamptz)
  from public, anon, authenticated;

grant execute on function public.get_scan_correction_analytics(timestamptz)
  to service_role;

alter table public.searches enable row level security;
alter table public.scan_corrections enable row level security;