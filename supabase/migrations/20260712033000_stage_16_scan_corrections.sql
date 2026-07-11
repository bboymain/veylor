-- Stage 16: explicit user scan-correction evidence.
--
-- Corrections are linked to the exact persisted scan and detected item. Only
-- explicit before/after field changes are stored; images and untouched model
-- output are never copied into this table.

create table if not exists public.scan_corrections (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches(id) on delete cascade,
  item_id text not null,
  field_name text not null,
  previous_value text,
  corrected_value text,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.scan_corrections'::regclass
      and conname = 'scan_corrections_field_name_check'
  ) then
    alter table public.scan_corrections
      add constraint scan_corrections_field_name_check
      check (field_name in ('name', 'category', 'color', 'style', 'material', 'pattern', 'visibleBrand')) not valid;
  end if;
end $$;

alter table public.scan_corrections
  validate constraint scan_corrections_field_name_check;

create index if not exists scan_corrections_search_created_idx
  on public.scan_corrections (search_id, created_at desc);

create index if not exists scan_corrections_field_created_idx
  on public.scan_corrections (field_name, created_at desc);

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
begin
  if p_search_id is null
     or nullif(trim(p_item_id), '') is null
     or p_field_name not in ('name', 'category', 'color', 'style', 'material', 'pattern', 'visibleBrand')
     or coalesce(p_previous_value, '') = coalesce(p_corrected_value, '') then
    return false;
  end if;

  if not exists (
    select 1 from public.searches s
    where s.id = p_search_id
      and s.search_type = 'scan'
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
    trim(p_item_id),
    p_field_name,
    nullif(trim(p_previous_value), ''),
    nullif(trim(p_corrected_value), ''),
    p_created_at
  );

  return true;
end;
$$;

revoke all on function public.record_scan_correction(uuid, text, text, text, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.record_scan_correction(uuid, text, text, text, text, timestamptz)
  to service_role;

alter table public.scan_corrections enable row level security;