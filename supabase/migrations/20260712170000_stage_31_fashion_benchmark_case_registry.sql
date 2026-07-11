-- Stage 31: private fashion benchmark case registry.
--
-- Stores curated expected labels and a private storage path for controlled
-- accuracy testing. Access remains service-role-only behind RLS. No shopper
-- identifiers, production scan rows, public uploads, or benchmark image bytes
-- are stored in this table.

create table if not exists public.fashion_benchmark_cases (
  case_id text primary key,
  image_storage_path text not null,
  expected_items jsonb not null,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.fashion_benchmark_cases'::regclass
      and conname = 'fashion_benchmark_cases_case_id_check'
  ) then
    alter table public.fashion_benchmark_cases
      add constraint fashion_benchmark_cases_case_id_check
      check (
        case_id = lower(case_id)
        and case_id ~ '^[a-z0-9][a-z0-9_-]{2,79}$'
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.fashion_benchmark_cases'::regclass
      and conname = 'fashion_benchmark_cases_path_check'
  ) then
    alter table public.fashion_benchmark_cases
      add constraint fashion_benchmark_cases_path_check
      check (
        length(trim(image_storage_path)) between 1 and 500
        and image_storage_path !~ '(^|/)\.\.(/|$)'
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.fashion_benchmark_cases'::regclass
      and conname = 'fashion_benchmark_cases_expected_items_check'
  ) then
    alter table public.fashion_benchmark_cases
      add constraint fashion_benchmark_cases_expected_items_check
      check (
        jsonb_typeof(expected_items) = 'array'
        and jsonb_array_length(expected_items) between 1 and 20
      ) not valid;
  end if;
end $$;

alter table public.fashion_benchmark_cases
  validate constraint fashion_benchmark_cases_case_id_check;

alter table public.fashion_benchmark_cases
  validate constraint fashion_benchmark_cases_path_check;

alter table public.fashion_benchmark_cases
  validate constraint fashion_benchmark_cases_expected_items_check;

create index if not exists fashion_benchmark_cases_active_updated_idx
  on public.fashion_benchmark_cases (active, updated_at desc);

create or replace function public.upsert_fashion_benchmark_case(
  p_case_id text,
  p_image_storage_path text,
  p_expected_items jsonb,
  p_notes text default null,
  p_active boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_case_id text := lower(trim(p_case_id));
  v_path text := trim(p_image_storage_path);
  v_notes text := nullif(trim(p_notes), '');
begin
  if v_case_id is null
     or v_case_id !~ '^[a-z0-9][a-z0-9_-]{2,79}$'
     or v_path is null
     or length(v_path) > 500
     or v_path ~ '(^|/)\.\.(/|$)'
     or jsonb_typeof(p_expected_items) <> 'array'
     or jsonb_array_length(p_expected_items) not between 1 and 20
     or p_active is null then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_expected_items) item
    where jsonb_typeof(item) <> 'object'
      or nullif(trim(item ->> 'category'), '') is null
      or jsonb_typeof(item -> 'colors') <> 'array'
      or jsonb_array_length(item -> 'colors') = 0
  ) then
    return false;
  end if;

  insert into public.fashion_benchmark_cases (
    case_id,
    image_storage_path,
    expected_items,
    notes,
    active,
    updated_at
  ) values (
    v_case_id,
    v_path,
    p_expected_items,
    v_notes,
    p_active,
    now()
  )
  on conflict (case_id) do update
  set image_storage_path = excluded.image_storage_path,
      expected_items = excluded.expected_items,
      notes = excluded.notes,
      active = excluded.active,
      updated_at = now();

  return true;
end;
$$;

revoke all on table public.fashion_benchmark_cases
  from public, anon, authenticated;

revoke all on function public.upsert_fashion_benchmark_case(
  text,
  text,
  jsonb,
  text,
  boolean
) from public, anon, authenticated;

grant select, insert, update, delete
  on table public.fashion_benchmark_cases
  to service_role;

grant execute on function public.upsert_fashion_benchmark_case(
  text,
  text,
  jsonb,
  text,
  boolean
) to service_role;

alter table public.fashion_benchmark_cases
  enable row level security;
