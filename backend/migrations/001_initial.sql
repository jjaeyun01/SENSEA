-- Supabase schema scaffold. Not applied automatically; no demo data is inserted.
begin;

create table public.waypoints (
  id text primary key,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  landmark_description text not null,
  verified_at timestamptz
);

create table public.places (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  waypoint_id text not null references public.waypoints(id),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  entrance_notes text,
  verified_at timestamptz
);

create table public.path_edges (
  id text primary key,
  from_waypoint text not null references public.waypoints(id),
  to_waypoint text not null references public.waypoints(id),
  distance_m double precision not null check (distance_m > 0 and distance_m < 'Infinity'::float8),
  pedestrian_verified boolean not null default false,
  verified_at timestamptz,
  instruction text not null,
  reverse_instruction text,
  bidirectional boolean not null default true,
  check (from_waypoint <> to_waypoint),
  check (not pedestrian_verified or verified_at is not null),
  check (not bidirectional or reverse_instruction is not null)
);

create table public.noise_observations (
  id uuid primary key default gen_random_uuid(),
  edge_id text not null references public.path_edges(id),
  relative_noise double precision not null check (relative_noise between 0 and 1),
  observed_at timestamptz not null default now()
);
create index noise_edge_time on public.noise_observations(edge_id, observed_at desc);

-- Server adapter only. No mobile client access or permissive policies.
alter table public.places enable row level security;
alter table public.waypoints enable row level security;
alter table public.path_edges enable row level security;
alter table public.noise_observations enable row level security;
revoke all on public.places, public.waypoints, public.path_edges, public.noise_observations
  from anon, authenticated;
grant select, insert, update, delete
  on public.places, public.waypoints, public.path_edges, public.noise_observations
  to service_role;

commit;
