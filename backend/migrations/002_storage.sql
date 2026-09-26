-- Apply after 001_initial.sql. Adds server-only storage RPCs; inserts/deletes no data.
-- Review grants before applying to an existing project: service_role loses table mutation
-- privileges except noise-summary insertion. Provision verified graph data as an owner.
begin;

create index if not exists places_waypoint on public.places(waypoint_id);
create index if not exists path_edges_from_waypoint on public.path_edges(from_waypoint);
create index if not exists path_edges_to_waypoint on public.path_edges(to_waypoint);
-- Supports a separately reviewed retention job; this migration does not schedule or delete.
create index if not exists noise_observed_at on public.noise_observations(observed_at);

-- A scalar JSON result avoids PostgREST's table-row limit truncating a graph. All three
-- arrays are read in one statement snapshot. Coordinates remain authored database data.
create or replace function public.sensea_graph()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'places', coalesce((select jsonb_agg(to_jsonb(p) order by p.id)
                       from public.places p), '[]'::jsonb),
    'waypoints', coalesce((select jsonb_agg(to_jsonb(w) order by w.id)
                          from public.waypoints w), '[]'::jsonb),
    'edges', coalesce((select jsonb_agg(to_jsonb(e) order by e.id)
                      from public.path_edges e), '[]'::jsonb)
  );
$$;

-- Literal case-insensitive substring search: %, _, commas, etc. are never SQL filters.
create or replace function public.sensea_search_places(p_query text)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select coalesce(jsonb_agg(to_jsonb(p) order by p.name, p.id), '[]'::jsonb)
  from public.places p
  where position(lower(p_query) in lower(p.name)) > 0;
$$;

-- Keep memory-store aggregation semantics: inclusive TTL cutoff, no future observations,
-- latest <=1000 samples per edge. Expired rows remain stored until a separate retention job.
-- Every distinct requested ID has exactly one result, including unknown/expired summaries.
create or replace function public.sensea_noise_summaries(
  p_edge_ids text[], p_now timestamptz, p_ttl_seconds integer
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'edge_id', requested.edge_id,
    'relative_noise', summary.relative_noise,
    'latest_observed_at', summary.latest_observed_at,
    'sample_count', summary.sample_count
  ) order by requested.edge_id), '[]'::jsonb)
  from (select distinct unnest(p_edge_ids) as edge_id) requested
  cross join lateral (
    select avg(recent.relative_noise) as relative_noise,
           max(recent.observed_at) as latest_observed_at,
           count(*) as sample_count
    from (
      select n.relative_noise, n.observed_at
      from public.noise_observations n
      where n.edge_id = requested.edge_id
        and n.observed_at >= p_now - make_interval(secs => p_ttl_seconds)
        and n.observed_at <= p_now
      order by n.observed_at desc, n.id desc
      limit 1000
    ) recent
  ) summary;
$$;

-- Consent is checked by the API before calling this function. Only the API's relative
-- summary is accepted: no audio, client timestamp, user identity or user coordinates.
-- PostgREST executes the function in a transaction; insertion/summary succeed together.
create or replace function public.sensea_add_noise(
  p_edge_id text, p_relative_noise double precision, p_ttl_seconds integer
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  observed_now timestamptz := clock_timestamp();
begin
  if p_ttl_seconds is null or p_ttl_seconds < 1 or p_ttl_seconds > 86400 then
    raise exception 'Invalid noise TTL' using errcode = '22023';
  end if;
  insert into public.noise_observations(edge_id, relative_noise, observed_at)
  values (p_edge_id, p_relative_noise, observed_now);
  -- An unknown edge fails the existing FK with SQLSTATE 23503; the adapter returns 404.
  return public.sensea_noise_summaries(array[p_edge_id], observed_now, p_ttl_seconds) -> 0;
end;
$$;

-- Keep RLS from 001 enabled and remove PostgreSQL's default PUBLIC function execution.
revoke all on function public.sensea_graph() from public, anon, authenticated;
revoke all on function public.sensea_search_places(text) from public, anon, authenticated;
revoke all on function public.sensea_noise_summaries(text[], timestamptz, integer)
  from public, anon, authenticated;
revoke all on function public.sensea_add_noise(text, double precision, integer)
  from public, anon, authenticated;
grant execute on function public.sensea_graph() to service_role;
grant execute on function public.sensea_search_places(text) to service_role;
grant execute on function public.sensea_noise_summaries(text[], timestamptz, integer)
  to service_role;
grant execute on function public.sensea_add_noise(text, double precision, integer)
  to service_role;

-- Invoker functions need these exact table privileges. No mobile role receives access.
revoke all on public.places, public.waypoints, public.path_edges, public.noise_observations
  from public, anon, authenticated, service_role;
grant select on public.places, public.waypoints, public.path_edges, public.noise_observations
  to service_role;
grant insert (edge_id, relative_noise, observed_at) on public.noise_observations to service_role;

commit;
