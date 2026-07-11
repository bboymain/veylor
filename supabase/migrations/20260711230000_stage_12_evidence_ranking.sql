-- Stage 12: bounded, evidence-based product ranking support.
--
-- Returns aggregate product evidence only for explicitly requested normalized
-- URLs. Ranking is performed in application code with a bounded displacement;
-- this function does not alter provider order or persist ranking decisions.

create or replace function public.get_product_ranking_evidence(
  p_normalized_product_urls text[]
)
returns table (
  normalized_product_url text,
  verification_status text,
  freshness_status text,
  total_impressions bigint,
  total_clicks bigint,
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

alter table public.products enable row level security;
alter table public.alternatives enable row level security;