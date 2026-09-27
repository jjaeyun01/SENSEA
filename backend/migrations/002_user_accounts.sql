-- User-owned data for Supabase Auth. Apply after 001_initial.sql.
-- Passwords intentionally live only in Supabase Auth (auth.users), never here.
begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '' check (char_length(name) <= 100),
  phone_number text check (phone_number is null or char_length(phone_number) <= 40),
  emergency_contact text check (emergency_contact is null or char_length(emergency_contact) <= 120),
  timezone text not null default 'America/Chicago' check (char_length(timezone) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  route_priority text not null default 'safety'
    check (route_priority in ('fastest', 'flat', 'safety', 'balanced')),
  avoid_stairs boolean not null default true,
  avoid_mixed_traffic boolean not null default true,
  prefer_crosswalks boolean not null default true,
  avoid_construction boolean not null default true,
  noise_policy text not null default 'automatic_day_night'
    check (noise_policy = 'automatic_day_night'),
  daytime_noise_preference text not null default 'quiet'
    check (daytime_noise_preference = 'quiet'),
  nighttime_noise_preference text not null default 'active'
    check (nighttime_noise_preference = 'active'),
  day_starts_at time not null default '07:00',
  night_starts_at time not null default '19:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (day_starts_at < night_starts_at)
);

create table public.user_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  external_place_id text not null check (char_length(external_place_id) <= 200),
  name text not null check (char_length(name) between 1 and 200),
  address text check (address is null or char_length(address) <= 500),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  is_saved boolean not null default false,
  is_favorite boolean not null default false,
  last_visited_at timestamptz,
  visit_count integer not null default 0 check (visit_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, external_place_id),
  unique (user_id, id)
);
create index user_places_recent_idx
  on public.user_places(user_id, last_visited_at desc nulls last);
create index user_places_favorite_idx
  on public.user_places(user_id, is_favorite) where is_favorite;

create table public.route_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  destination_place_id uuid,
  route_external_id text check (route_external_id is null or char_length(route_external_id) <= 200),
  origin_name text,
  destination_name text not null,
  distance_m double precision check (distance_m is null or distance_m >= 0),
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  has_stairs boolean,
  avoided_mixed_traffic boolean,
  used_crosswalks boolean,
  avoided_construction boolean,
  applied_noise_preference text not null check (applied_noise_preference in ('quiet', 'active')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (user_id, destination_place_id)
    references public.user_places(user_id, id) on delete set null (destination_place_id)
);
create index route_history_user_time_idx on public.route_history(user_id, started_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute procedure public.set_updated_at();
create trigger preferences_set_updated_at before update on public.user_preferences
for each row execute procedure public.set_updated_at();
create trigger places_set_updated_at before update on public.user_places
for each row execute procedure public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, phone_number, emergency_contact)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone_number', ''),
    nullif(new.raw_user_meta_data ->> 'emergency_contact', '')
  )
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Backfill accounts that existed before this migration was applied.
insert into public.profiles (id, name, phone_number, emergency_contact)
select id,
  coalesce(raw_user_meta_data ->> 'name', raw_user_meta_data ->> 'full_name', ''),
  nullif(raw_user_meta_data ->> 'phone_number', ''),
  nullif(raw_user_meta_data ->> 'emergency_contact', '')
from auth.users
on conflict (id) do nothing;
insert into public.user_preferences (user_id)
select id from auth.users
on conflict (user_id) do nothing;

alter table public.profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.user_places enable row level security;
alter table public.route_history enable row level security;

create policy "profiles_select_own" on public.profiles for select to authenticated
using ((select auth.uid()) = id);
create policy "profiles_insert_own" on public.profiles for insert to authenticated
with check ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles for update to authenticated
using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "profiles_delete_own" on public.profiles for delete to authenticated
using ((select auth.uid()) = id);

create policy "preferences_select_own" on public.user_preferences for select to authenticated
using ((select auth.uid()) = user_id);
create policy "preferences_insert_own" on public.user_preferences for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy "preferences_update_own" on public.user_preferences for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "preferences_delete_own" on public.user_preferences for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "places_select_own" on public.user_places for select to authenticated
using ((select auth.uid()) = user_id);
create policy "places_insert_own" on public.user_places for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy "places_update_own" on public.user_places for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "places_delete_own" on public.user_places for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "route_history_select_own" on public.route_history for select to authenticated
using ((select auth.uid()) = user_id);
create policy "route_history_insert_own" on public.route_history for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy "route_history_update_own" on public.route_history for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "route_history_delete_own" on public.route_history for delete to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.profiles, public.user_preferences, public.user_places, public.route_history
  from anon;
grant select, insert, update, delete
  on public.profiles, public.user_preferences, public.user_places, public.route_history
  to authenticated, service_role;

commit;
