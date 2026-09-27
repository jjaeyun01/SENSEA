# UW official building catalog

Source: https://map.wisc.edu/api/v1/map_objects.geojson
Collected September 27, 2026: 219 map entries (216 `building`, 3 `building_partial`).
This is the official map's building catalog, including entries representing building groups.
It is not a count of every physical structure owned by UW.

- `buildings.json`: names, UW IDs, addresses, building numbers, coordinates, geometry and source.
- `buildings.csv`: tabular export; use SQL to import both related tables.
- `import.sql`: transactional, repeatable import into Supabase `places` and `waypoints`.

From the backend directory, refresh with:

```sh
python3 scripts/export_uw_buildings.py --output data/uw-buildings
```

Execute the regenerated `import.sql` in your project's Supabase SQL Editor.
It adds catalog metadata columns, upserts by UW ID, preserves verified coordinates,
and never deletes buildings or changes RLS/access permissions. New points have no
entrance verification. Polygon geometry does not establish accessible entrances or paths.

The current app still searches UW through `/campus/places`; importing this catalog does
not switch the app to querying Supabase. No service-role secret is embedded in this exporter.

## More info facilities

Collected all 219 building detail pages from
`https://map.wisc.edu/api/v1/map_objects/{id}.html` on September 27, 2026.
589 building/category/name entries: 506 departments, 49 dining, 25 libraries, 9 InfoLabs.
A facility may appear in several categories; these are not 589 distinct businesses.

`facilities.json` preserves names, descriptions, public links and source IDs/URLs.
Displayed contact information and hours are snapshots; linked external pages are not crawled.
`import-facilities.sql` upserts `place_facilities` linked to existing `places`, with
RLS enabled and access limited to the service role. `places.search_names` includes
building and facility names without treating departments as true building aliases.
It does not delete existing records or change verified entrances.

Refresh from the backend directory:

```sh
python3 scripts/export_uw_facilities.py --catalog data/uw-buildings/buildings.json --output data/uw-buildings
```

Run the generated SQL after the building import. This stores searchable names but
does not switch the current `/campus/places` endpoint to Supabase.
