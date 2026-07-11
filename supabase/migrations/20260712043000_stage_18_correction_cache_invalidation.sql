-- Stage 18: correction-aware verified-cache invalidation.
--
-- A shopper correction is explicit evidence that the scan output was not fully
-- correct. The corrected scan and any verified source scan that produced it are
-- removed from the reusable cache immediately. Correction evidence remains
-- server-only and no image data is stored.

create or replace function public.record_scan_correction(
  p_search_id uuid,
  p_item_id text,
  p_field_name text,
  p_previous_value text,
  p_corrected_value text,
  p_created_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cache_source_search_id uuid;
begin
  if p_search_id is null
     or nullif(trim(p_item_id), '') is null
     or p_field_name not in (
       'name',
       'category',
       'color',
       'style',
       'material',
       'pattern',
       'visibleBrand'
     )
     or coalesce(p_previous_value, '')
        = coalesce(p_corrected_value, '') then
    return false;
  end if;

  select s.cache_source_search_id
  into v_cache_source_search_id
  from public.searches s
  where s.id = p_search_id
    and s.search_type = 'scan'
  for update;

  if not found then
    return false;
  end if;

  insert into public.scan_corrections (
    search_id,
    item_id,
    field_name,
    previous_value,
    corrected_value,
    created_at
  ) values (
    p_search_id,
    trim(p_item_id),
    p_field_name,
    nullif(trim(p_previous_value), ''),
    nullif(trim(p_corrected_value), ''),
    p_created_at
  );

  update public.searches
  set
    cache_status = 'rejected',
    cache_verified_at = null,
    cache_verification_evidence = 'user_scan_correction'
  where id = p_search_id;

  if v_cache_source_search_id is not null then
    update public.searches
    set
      cache_status = 'rejected',
      cache_verified_at = null,
      cache_verification_evidence = 'derived_scan_correction'
    where id = v_cache_source_search_id;
  end if;

  return true;
end;
$$;

revoke all on function public.record_scan_correction(
  uuid,
  text,
  text,
  text,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.record_scan_correction(
  uuid,
  text,
  text,
  text,
  text,
  timestamptz
) to service_role;

alter table public.searches enable row level security;
alter table public.scan_corrections enable row level security;
