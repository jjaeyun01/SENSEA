"""Export the official UW map building directory and an idempotent Supabase import.
Run: python3 scripts/export_uw_buildings.py --output data/uw-buildings
Coordinates are representative building points, never verified entrances.
"""

import argparse
import csv
import json
import math
from pathlib import Path
from urllib.request import urlopen
from uuid import NAMESPACE_URL, uuid5

SOURCE = "https://map.wisc.edu/api/v1/map_objects.geojson"


def collect(raw):
    buildings = []
    seen = set()
    for item in raw:
        if item.get("object_type") not in {"building", "building_partial"}:
            continue
        identifier = str(item["id"])
        name = item["name"].strip()
        lon, lat = item["lnglat"]
        if identifier in seen or not identifier.isdigit() or not name:
            raise ValueError("Invalid or duplicate UW building")
        if not all(type(n) in (int, float) and math.isfinite(n) for n in (lat, lon)) or not (
            -90 <= lat <= 90 and -180 <= lon <= 180
        ):
            raise ValueError("Invalid building coordinates")
        seen.add(identifier)
        buildings.append(
            dict(
                id=str(
                    uuid5(
                        NAMESPACE_URL,
                        f"https://map.wisc.edu/api/v1/map_objects/{identifier}.geojson",
                    )
                ),
                uw_map_object_id=identifier,
                waypoint_id=f"uw-building-{identifier}",
                name=name,
                latitude=lat,
                longitude=lon,
                street_address=item.get("street_address"),
                building_number=item.get("building_number"),
                object_type=item["object_type"],
                geometry=item.get("geojson"),
                source_url=SOURCE,
            )
        )
    if not buildings:
        raise ValueError("UW returned no buildings; import aborted")
    return sorted(buildings, key=lambda b: int(b["uw_map_object_id"]))


def import_sql(buildings):
    payload = json.dumps(buildings, ensure_ascii=False, separators=(",", ":"))
    if "$uw_buildings$" in payload:
        raise ValueError("Unexpected SQL delimiter in source")
    return (
        """-- Official UW map catalog. No entrance or pedestrian path verification inferred.
BEGIN;
ALTER TABLE public.places ADD COLUMN IF NOT EXISTS uw_map_object_id text;
ALTER TABLE public.places ADD COLUMN IF NOT EXISTS street_address text;
ALTER TABLE public.places ADD COLUMN IF NOT EXISTS building_number text;
ALTER TABLE public.places ADD COLUMN IF NOT EXISTS object_type text;
ALTER TABLE public.places ADD COLUMN IF NOT EXISTS geometry jsonb;
ALTER TABLE public.places ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE public.places ADD COLUMN IF NOT EXISTS source_updated_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS places_uw_map_object_id ON public.places(uw_map_object_id);
CREATE TEMP TABLE uw_building_import ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset($uw_buildings$"""
        + payload
        + """$uw_buildings$::jsonb)
AS b(id uuid, uw_map_object_id text, waypoint_id text, name text,
latitude double precision, longitude double precision, street_address text,
building_number text, object_type text, geometry jsonb, source_url text);
INSERT INTO public.waypoints(id, latitude, longitude, landmark_description)
SELECT waypoint_id, latitude, longitude, name || ' — UW mapped building point; entrance unverified'
FROM uw_building_import
ON CONFLICT(id) DO UPDATE SET latitude=excluded.latitude, longitude=excluded.longitude,
landmark_description=excluded.landmark_description WHERE waypoints.verified_at IS NULL;
INSERT INTO public.places(id, name, waypoint_id, latitude, longitude, entrance_notes,
uw_map_object_id, street_address, building_number, object_type, geometry, source_url,
source_updated_at)
SELECT id, name, waypoint_id, latitude, longitude,
'UW representative building point. Entrance not verified.',
uw_map_object_id, street_address, building_number, object_type, geometry, source_url, now()
FROM uw_building_import
ON CONFLICT(uw_map_object_id) DO UPDATE SET name=excluded.name,
latitude=CASE WHEN places.verified_at IS NULL THEN excluded.latitude ELSE places.latitude END,
longitude=CASE WHEN places.verified_at IS NULL THEN excluded.longitude ELSE places.longitude END,
street_address=excluded.street_address, building_number=excluded.building_number,
object_type=excluded.object_type, geometry=excluded.geometry, source_url=excluded.source_url,
source_updated_at=excluded.source_updated_at;
COMMIT;
SELECT count(*) AS uw_buildings, count(*) FILTER(WHERE object_type='building') AS buildings,
count(*) FILTER(WHERE object_type='building_partial') AS partial_buildings,
count(*) FILTER(WHERE verified_at IS NOT NULL) AS verified_entrances
FROM public.places WHERE uw_map_object_id IS NOT NULL;
"""
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("data/uw-buildings"))
    parser.add_argument("--input", type=Path, help="Previously downloaded official GeoJSON")
    args = parser.parse_args()
    if args.input:
        raw = json.loads(args.input.read_text())
    else:
        with urlopen(SOURCE, timeout=30) as response:
            raw = json.load(response)
    buildings = collect(raw)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "buildings.json").write_text(
        json.dumps(buildings, ensure_ascii=False, indent=2) + "\n"
    )
    (args.output / "import.sql").write_text(import_sql(buildings))
    fields = [k for k in buildings[0] if k != "geometry"]
    with (args.output / "buildings.csv").open("w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
        writer.writeheader()
        writer.writerows(buildings)
    print(f"Exported {len(buildings)} UW buildings to {args.output}")


if __name__ == "__main__":
    main()
