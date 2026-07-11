-- Stage 15: server-only paid API quotas keyed by anonymous shopper UUID.
--
-- No IP addresses, names, emails, images, or advertising identifiers are stored.
-- Quotas protect paid Gemini and SerpApi calls while verified cache hits remain free.

create table if not exists public.api_quota_windows (
  profile_id uuid not null,
  action text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (profile_id, action)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.api_quota_windows'::regclass
      and conname = 'api_quota_windows_action_check'
  ) then
    alter table public.api_quota_windows
      add constraint api_quota_windows_action_check
      check (action in ('gemini_scan', 'product_search')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.api_quota_windows'::regclass
      and conname = 'api_quota_windows_request_count_check'
  ) then
    alter table public.api_quota_windows
      add constraint api_quota_windows_request_count_check
      check (request_count >= 0) not valid;
  end if;
end $$;

alter table public.api_quota_windows
  validate constraint api_quota_windows_action_check;

alter table public.api_quota_windows
  validate constraint api_quota_windows_request_count_check;

create index if not exists api_quota_windows_updated_at_idx
  on public.api_quota_windows (updated_at desc);

create or replace function public.consume_api_quota(
  p_profile_id uuid,
  p_action text,
  p_limit integer,
  p_window_seconds integer,
  p_now timestamptz default now()
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.api_quota_windows%rowtype;
  v_window interval;
  v_elapsed_seconds integer;
begin
  if p_profile_id is null
     or p_action not in ('gemini_scan', 'product_search')
     or p_limit <= 0
     or p_window_seconds <= 0 then
    return query select false, 0, p_window_seconds;
    return;
  end if;

  v_window := make_interval(secs => p_window_seconds);

  insert into public.api_quota_windows (
    profile_id,
    action,
    window_started_at,
    request_count,
    updated_at
  ) values (
    p_profile_id,
    p_action,
    p_now,
    1,
    p_now
  )
  on conflict (profile_id, action) do update
  set
    window_started_at = case
      when public.api_quota_windows.window_started_at + v_window <= p_now
        then p_now
      else public.api_quota_windows.window_started_at
    end,
    request_count = case
      when public.api_quota_windows.window_started_at + v_window <= p_now
        then 1
      else public.api_quota_windows.request_count + 1
    end,
    updated_at = p_now
  returning * into v_row;

  if v_row.request_count <= p_limit then
    return query
    select true, greatest(p_limit - v_row.request_count, 0), 0;
    return;
  end if;

  v_elapsed_seconds := floor(extract(epoch from (p_now - v_row.window_started_at)))::integer;
  return query
  select false, 0, greatest(p_window_seconds - v_elapsed_seconds, 1);
end;
$$;

revoke all on function public.consume_api_quota(uuid, text, integer, integer, timestamptz)
  from public, anon, authenticated;

grant execute on function public.consume_api_quota(uuid, text, integer, integer, timestamptz)
  to service_role;

alter table public.api_quota_windows enable row level security;