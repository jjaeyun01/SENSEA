-- Privacy-preserving, foreground-only noise-map collection for the hackathon MVP.
-- Apply after 001_initial.sql and 002_user_accounts.sql.
-- No audio content or exact GPS coordinates are stored.
begin;

-- An early hackathon draft used these two names with a different shape. If that
-- draft is present (no consent table exists yet), preserve it outside `public`
-- so the complete v3 schema can be installed without deleting any data.
create schema if not exists sensea_archive;
do $$
begin
  if to_regclass('public.noise_collection_consents') is null then
    if to_regclass('public.noise_measurements') is not null then
      if to_regclass('sensea_archive.noise_measurements') is not null then
        raise exception 'sensea_archive.noise_measurements already exists; inspect it before retrying';
      end if;
      alter table public.noise_measurements set schema sensea_archive;
    end if;
    if to_regclass('public.noise_grid_hourly') is not null then
      if to_regclass('sensea_archive.noise_grid_hourly') is not null then
        raise exception 'sensea_archive.noise_grid_hourly already exists; inspect it before retrying';
      end if;
      alter table public.noise_grid_hourly set schema sensea_archive;
    end if;
  end if;
end;
$$;

create table public.noise_collection_consents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  consent_version text not null check (char_length(consent_version) between 1 and 40),
  foreground_only boolean not null default true check (foreground_only),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.noise_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Roughly 30-45 m cells near Madison. Exact GPS is discarded on-device.
  grid_cell_id text not null check (grid_cell_id ~ '^-?[0-9]+:-?[0-9]+$'),
  grid_latitude double precision not null check (grid_latitude between 43.02 and 43.12),
  grid_longitude double precision not null check (grid_longitude between -89.50 and -89.30),
  edge_id text references public.path_edges(id) on delete set null,
  average_dbfs double precision not null check (average_dbfs between -160 and 0),
  peak_dbfs double precision not null check (peak_dbfs between -160 and 0),
  relative_noise double precision not null check (relative_noise between 0 and 1),
  sample_duration_ms integer not null check (sample_duration_ms between 1000 and 15000),
  sample_count integer not null check (sample_count between 3 and 200),
  location_accuracy_m double precision not null check (location_accuracy_m between 0 and 50),
  platform text not null check (platform in ('ios', 'android')),
  app_version text not null check (char_length(app_version) between 1 and 40),
  calibration_version text not null default 'relative-v1'
    check (calibration_version = 'relative-v1'),
  consent_version text not null check (char_length(consent_version) between 1 and 40),
  measured_at timestamptz not null,
  received_at timestamptz not null default now(),
  check (peak_dbfs >= average_dbfs),
  check (
    grid_cell_id = floor(grid_latitude / 0.0004)::bigint::text
      || ':' || floor(grid_longitude / 0.0004)::bigint::text
  )
);
create index noise_measurements_cell_time_idx
  on public.noise_measurements(grid_cell_id, measured_at desc);
create index noise_measurements_user_time_idx
  on public.noise_measurements(user_id, measured_at desc);

create table public.noise_grid_hourly (
  grid_cell_id text not null,
  hour_bucket timestamptz not null,
  grid_latitude double precision not null,
  grid_longitude double precision not null,
  average_relative_noise double precision not null check (average_relative_noise between 0 and 1),
  median_relative_noise double precision not null check (median_relative_noise between 0 and 1),
  p90_relative_noise double precision not null check (p90_relative_noise between 0 and 1),
  measurement_count integer not null check (measurement_count > 0),
  contributing_users integer not null check (contributing_users > 0),
  updated_at timestamptz not null default now(),
  primary key (grid_cell_id, hour_bucket)
);
create index noise_grid_hourly_recent_idx on public.noise_grid_hourly(hour_bucket desc);

create or replace function public.refresh_noise_grid_hourly()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_cell text;
  target_hour timestamptz;
begin
  if tg_op = 'DELETE' then
    target_cell := old.grid_cell_id;
    target_hour := date_trunc('hour', old.measured_at);
  else
    target_cell := new.grid_cell_id;
    target_hour := date_trunc('hour', new.measured_at);
  end if;
  delete from public.noise_grid_hourly
  where grid_cell_id = target_cell and hour_bucket = target_hour;

  insert into public.noise_grid_hourly (
    grid_cell_id, hour_bucket, grid_latitude, grid_longitude,
    average_relative_noise, median_relative_noise, p90_relative_noise,
    measurement_count, contributing_users, updated_at
  )
  select
    grid_cell_id,
    date_trunc('hour', measured_at),
    avg(grid_latitude),
    avg(grid_longitude),
    avg(relative_noise),
    percentile_cont(0.5) within group (order by relative_noise),
    percentile_cont(0.9) within group (order by relative_noise),
    count(*)::integer,
    count(distinct user_id)::integer,
    now()
  from public.noise_measurements
  where grid_cell_id = target_cell
    and date_trunc('hour', measured_at) = target_hour
  group by grid_cell_id, date_trunc('hour', measured_at);
  return null;
end;
$$;

create trigger noise_measurements_refresh_grid
after insert or delete on public.noise_measurements
for each row execute procedure public.refresh_noise_grid_hourly();
revoke execute on function public.refresh_noise_grid_hourly() from public, anon, authenticated;

create or replace function public.can_submit_noise_measurement(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user = (select auth.uid())
    and not exists (
      select 1 from public.noise_measurements m
      where m.user_id = target_user and m.received_at > now() - interval '20 seconds'
    )
    and (
      select count(*) from public.noise_measurements m
      where m.user_id = target_user and m.received_at > now() - interval '1 day'
    ) < 1000;
$$;
revoke execute on function public.can_submit_noise_measurement(uuid) from public, anon;
grant execute on function public.can_submit_noise_measurement(uuid) to authenticated, service_role;

create trigger noise_consents_set_updated_at
before update on public.noise_collection_consents
for each row execute procedure public.set_updated_at();

alter table public.noise_collection_consents enable row level security;
alter table public.noise_measurements enable row level security;
alter table public.noise_grid_hourly enable row level security;

create policy "noise_consent_select_own" on public.noise_collection_consents
for select to authenticated using ((select auth.uid()) = user_id);
create policy "noise_consent_insert_own" on public.noise_collection_consents
for insert to authenticated with check ((select auth.uid()) = user_id and revoked_at is null);
create policy "noise_consent_update_own" on public.noise_collection_consents
for update to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "noise_consent_delete_own" on public.noise_collection_consents
for delete to authenticated using ((select auth.uid()) = user_id);

create policy "noise_measurements_select_own" on public.noise_measurements
for select to authenticated using ((select auth.uid()) = user_id);
create policy "noise_measurements_insert_own_with_consent" on public.noise_measurements
for insert to authenticated with check (
  (select auth.uid()) = user_id
  and public.can_submit_noise_measurement(user_id)
  and measured_at between now() - interval '10 minutes' and now() + interval '1 minute'
  and received_at between now() - interval '1 minute' and now() + interval '1 minute'
  and exists (
    select 1 from public.noise_collection_consents c
    where c.user_id = (select auth.uid())
      and c.revoked_at is null
      and c.foreground_only
      and c.consent_version = noise_measurements.consent_version
  )
);
create policy "noise_measurements_delete_own" on public.noise_measurements
for delete to authenticated using ((select auth.uid()) = user_id);

-- Raw rows are private. Only cells with at least three distinct contributors are shared.
create policy "noise_grid_select_k_anonymous" on public.noise_grid_hourly
for select to authenticated using (contributing_users >= 3);

revoke all on public.noise_collection_consents, public.noise_measurements, public.noise_grid_hourly
  from anon;
grant select, insert, update, delete on public.noise_collection_consents to authenticated;
grant select, insert, delete on public.noise_measurements to authenticated;
grant select on public.noise_grid_hourly to authenticated;
grant select, insert, update, delete
  on public.noise_collection_consents, public.noise_measurements, public.noise_grid_hourly
  to service_role;

commit;
