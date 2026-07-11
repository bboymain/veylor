-- Stage 19: materialize explicit corrections into the canonical scan snapshot.
--
-- Correction history remains append-only in scan_corrections. The matching
-- detected item inside searches.detected_items is updated transactionally, and
-- forged or stale item IDs are rejected without writing evidence.

alter table public.searches
  add column if not exists correction_count integer not null default 0,
  add column if not exists last_corrected_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.searches'::regclass
      and conname = 'searches_correction_count_check'
  ) then
    alter table public.searches
      add constraint searches_correction_count_check
      check (correction_count >= 0) not valid;
  end if;
end $$;

alter table public.searches
  validate constraint searches_correction_count_check;

create index if not exists searches_last_corrected_at_idx
  on public.searches (last_corrected_at desc)
  where correction_count > 0;

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
  v_detected_items jsonb;
  v_normalized_item_id text;
  v_normalized_previous text;
  v_normalized_corrected text;
begin
  v_normalized_item_id := nullif(trim(p_item_id), '');
  v_normalized_previous := nullif(trim(p_previous_value), '');
  v_normalized_corrected := nullif(trim(p_corrected_value), '');

  if p_search_id is null
     or v_normalized_item_id is null
     or p_field_name not in (
       'name',
       'category',
       'color',
       'style',
       'material',
       'pattern',
       'visibleBrand'
     )
     or coalesce(v_normalized_previous, '')
        = coalesce(v_normalized_corrected, '') then
    return false;
  end if;

  select
    s.cache_source_search_id,
    s.detected_items
  into
    v_cache_source_search_id,
    v_detected_items
  from public.searches s
  where s.id = p_search_id
    and s.search_type = 'scan'
  for update;

  if not found
     or jsonb_typeof(v_detected_items) <> 'array'
     or not exists (
       select 1
       from jsonb_array_elements(v_detected_items) as item
       where item ->> 'id' = v_normalized_item_id
     ) then
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
    v_normalized_item_id,
    p_field_name,
    v_normalized_previous,
    v_normalized_corrected,
    p_created_at
  );

  update public.searches s
  set
    detected_items = (
      select jsonb_agg(
        case
          when item.value ->> 'id' = v_normalized_item_id then
            jsonb_set(
              item.value,
              array[p_field_name],
              coalesce(to_jsonb(v_normalized_corrected), 'null'::jsonb),
              true
            )
          else item.value
        end
        order by item.ordinality
      )
      from jsonb_array_elements(s.detected_items)
        with ordinality as item(value, ordinality)
    ),
    correction_count = s.correction_count + 1,
    last_corrected_at = p_created_at,
    cache_status = 'rejected',
    cache_verified_at = null,
    cache_verification_evidence = 'user_scan_correction'
  where s.id = p_search_id;

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
