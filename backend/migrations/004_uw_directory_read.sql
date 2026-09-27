-- Public campus-directory fields only. Private user data and raw place rows stay protected.
begin;

create or replace function public.sensea_uw_directory()
returns table (
  uw_map_object_id text,
  building_name text,
  street_address text,
  latitude double precision,
  longitude double precision,
  facility_name text,
  facility_category text
)
language sql stable security definer
set search_path = ''
as $$
  select p.uw_map_object_id, p.name, p.street_address, p.latitude, p.longitude,
         f.name, f.category
  from public.places p
  left join public.place_facilities f on f.place_id = p.id
  where p.uw_map_object_id is not null
  order by p.name, f.category, f.name
$$;

revoke all on function public.sensea_uw_directory() from public;
grant execute on function public.sensea_uw_directory() to anon, authenticated;
commit;
