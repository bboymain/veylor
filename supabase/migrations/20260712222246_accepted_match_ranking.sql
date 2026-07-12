-- Stage 1: accepted matches as bounded product-ranking evidence.
--
-- This migration changes only the server-only ranking evidence RPC. It reads
-- explicit acceptance signals without updating verification, authenticity,
-- cache, benchmark, model-promotion, or acceptance state.
--
-- PostgreSQL cannot replace a RETURNS TABLE function when its row shape
-- changes, so the drop and recreation must remain in the same transactional
-- migration. A failed migration therefore restores the prior function.

drop function if exists public.get_product_ranking_evidence(text[]);

create function public.get_product_ranking_evidence(
  p_normalized_product_urls text[]
)
returns table (
  normalized_product_url text,
  verification_status text,
  freshness_status text,
  total_impressions bigint,
  total_clicks bigint,
  total_acceptances bigint,
  latest_seen_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.normalized_product_url,
    p.verification_status,
    p.freshness_status,
    coalesce(sum(a.impression_count), 0)::bigint as total_impressions,
    coalesce(count(*) filter (where a.clicked), 0)::bigint as total_clicks,
    coalesce(count(*) filter (where a.accepted_match = true), 0)::bigint
      as total_acceptances,
    greatest(p.last_seen_at, p.freshness_checked_at) as latest_seen_at
  from public.products p
  left join public.alternatives a on a.product_id = p.id
  where p_normalized_product_urls is not null
    and cardinality(p_normalized_product_urls) > 0
    and p.normalized_product_url = any(p_normalized_product_urls)
  group by
    p.id,
    p.normalized_product_url,
    p.verification_status,
    p.freshness_status,
    p.last_seen_at,
    p.freshness_checked_at;
$$;

revoke all on function public.get_product_ranking_evidence(text[])
  from public, anon, authenticated;

grant execute on function public.get_product_ranking_evidence(text[])
  to service_role;

-- Rollback restores the Stage 12 definition automatically when the local
-- migration chain is reset with:
--   supabase migration down --local --last 1
-- Stage 12 recreates the same signature without total_acceptances and restores
-- the same service-role-only grants. Production rollback must likewise use a
-- reviewed forward migration containing that committed Stage 12 definition.
