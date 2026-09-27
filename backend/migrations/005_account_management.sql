-- Self-service account deletion. Apply after 002_user_accounts.sql.
-- Deleting auth.users cascades to all SENSEA user-owned tables.
begin;

create or replace function public.delete_own_sensea_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'Authentication is required';
  end if;
  delete from public.noise_measurements where user_id = caller;
  delete from public.noise_collection_consents where user_id = caller;
  delete from public.route_history where user_id = caller;
  delete from public.user_places where user_id = caller;
  delete from public.user_preferences where user_id = caller;
  delete from public.profiles where id = caller;
  insert into public.profiles (id) values (caller);
  insert into public.user_preferences (user_id) values (caller);
end;
$$;

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'Authentication is required';
  end if;
  delete from auth.users where id = caller;
  if not found then
    raise exception 'Account not found';
  end if;
end;
$$;

revoke all on function public.delete_own_sensea_data() from public, anon;
grant execute on function public.delete_own_sensea_data() to authenticated;
revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

commit;
