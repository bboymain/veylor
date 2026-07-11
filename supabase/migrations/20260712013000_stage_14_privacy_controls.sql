-- Stage 14: shopper transparency and privacy reset.
--
-- The reset function deletes only the exact anonymous shopper profile supplied
-- by the server-side HttpOnly cookie. It exposes no client table permissions.

create or replace function public.delete_shopper_profile(
  p_profile_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  if p_profile_id is null then
    return false;
  end if;

  delete from public.shopper_profiles
  where id = p_profile_id;

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function public.delete_shopper_profile(uuid)
  from public, anon, authenticated;

grant execute on function public.delete_shopper_profile(uuid)
  to service_role;

alter table public.shopper_profiles enable row level security;