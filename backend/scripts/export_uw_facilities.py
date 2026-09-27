"""Collect official building More info tabs; generate a repeatable Supabase import."""

import argparse
import asyncio
import json
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin
from uuid import NAMESPACE_URL, uuid5

import httpx

BASE = "https://map.wisc.edu"
CATEGORIES = {"departments", "dining", "libraries", "infolabs"}


def normalize(text):
    return " ".join(text.split())


class FacilitiesParser(HTMLParser):
    def __init__(self, building_id):
        super().__init__()
        self.building_id = building_id
        self.panel = None
        self.current = None
        self.link = None
        self.rows = []
        self.li_depth = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "sl-tab-panel":
            self.panel = attrs.get("name")
        if self.panel not in CATEGORIES:
            return
        if tag == "li" and self.panel == "departments":
            self.li_depth += 1
            if self.li_depth == 1:
                self.begin(None, None)
        if tag == "sl-details" and self.panel != "departments":
            self.begin(attrs.get("summary"), attrs.get("id"))
        if self.current and tag == "a":
            url = urljoin(BASE, attrs.get("href", ""))
            self.link = {"url": url, "parts": []}

    def begin(self, name, source_id):
        self.current = {"name": name, "source_id": source_id, "parts": [], "links": []}

    def handle_data(self, data):
        if self.current:
            self.current["parts"].append(data)
        if self.link:
            self.link["parts"].append(data)

    def handle_endtag(self, tag):
        if self.current and tag == "a" and self.link:
            label = normalize("".join(self.link["parts"]))
            url = self.link["url"]
            if label and not any(x in url for x in ["/rails/active_storage/", "mapcdn.wisc.cloud"]):
                self.current["links"].append({"label": label, "url": url})
            self.link = None
        if tag == "li" and self.panel == "departments":
            self.li_depth -= 1
            if self.li_depth == 0:
                self.finish()
        if tag == "sl-details" and self.panel in CATEGORIES:
            self.finish()
        if tag == "sl-tab-panel":
            self.panel = None

    def finish(self):
        if not self.current:
            return
        item = self.current
        text = normalize("".join(item["parts"]))
        name = normalize(item["name"] or text)
        if name:
            source_url = f"{BASE}/api/v1/map_objects/{self.building_id}.html"
            self.rows.append(
                {
                    "id": str(uuid5(NAMESPACE_URL, f"{source_url}#{self.panel}:{name.casefold()}")),
                    "uw_map_object_id": self.building_id,
                    "category": self.panel,
                    "name": name,
                    "description": text,
                    "links": item["links"],
                    "source_item_id": item["source_id"],
                    "source_url": source_url,
                }
            )
        self.current = None
        self.link = None


async def collect(buildings):
    semaphore = asyncio.Semaphore(3)
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:

        async def fetch(building):
            identifier = building["uw_map_object_id"]
            async with semaphore:
                for attempt in range(3):
                    try:
                        response = await client.get(f"{BASE}/api/v1/map_objects/{identifier}.html")
                        response.raise_for_status()
                        if (
                            "<sl-tab-panel" not in response.text
                            or "dialog-label" not in response.text
                        ):
                            raise ValueError(f"Unexpected More info format: {identifier}")
                        parser = FacilitiesParser(identifier)
                        parser.feed(response.text)
                        await asyncio.sleep(0.15)
                        return parser.rows
                    except (httpx.HTTPError, ValueError):
                        if attempt == 2:
                            raise
                        await asyncio.sleep(attempt + 1)

        batches = await asyncio.gather(*(fetch(building) for building in buildings))
    return sorted(
        {item["id"]: item for batch in batches for item in batch}.values(),
        key=lambda row: (int(row["uw_map_object_id"]), row["category"], row["name"]),
    )


def import_sql(rows):
    payload = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    if "$uw_facilities$" in payload:
        raise ValueError("Unexpected SQL delimiter")
    return (
        """BEGIN;
CREATE TABLE IF NOT EXISTS public.place_facilities (
  id uuid PRIMARY KEY, place_id uuid NOT NULL REFERENCES public.places(id),
  category text NOT NULL CHECK(category IN ('departments','dining','libraries','infolabs')),
  name text NOT NULL, description text, links jsonb NOT NULL DEFAULT '[]',
  source_item_id text, source_url text NOT NULL, source_updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS place_facilities_place_id ON public.place_facilities(place_id);
ALTER TABLE public.place_facilities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.place_facilities FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.place_facilities TO service_role;
ALTER TABLE public.places ADD COLUMN IF NOT EXISTS search_names text[] NOT NULL DEFAULT '{}';
CREATE TEMP TABLE uw_facility_import ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset($uw_facilities$"""
        + payload
        + """$uw_facilities$::jsonb)
AS f(id uuid, uw_map_object_id text, category text, name text, description text,
links jsonb, source_item_id text, source_url text);
DO $$ BEGIN
IF EXISTS(SELECT 1 FROM uw_facility_import f LEFT JOIN public.places p
ON p.uw_map_object_id=f.uw_map_object_id WHERE p.id IS NULL)
THEN RAISE EXCEPTION 'Missing parent building; import catalog first'; END IF;
END $$;
INSERT INTO public.place_facilities(id, place_id, category, name, description,
links, source_item_id, source_url, source_updated_at)
SELECT f.id, p.id, f.category, f.name, f.description, f.links,
f.source_item_id, f.source_url, now() FROM uw_facility_import f
JOIN public.places p ON p.uw_map_object_id=f.uw_map_object_id
ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description,
links=excluded.links, source_item_id=excluded.source_item_id,
source_url=excluded.source_url, source_updated_at=excluded.source_updated_at;
UPDATE public.places p SET search_names=(SELECT array_agg(DISTINCT n ORDER BY n)
FROM (SELECT unnest(p.search_names) AS n UNION SELECT p.name
UNION SELECT f.name FROM public.place_facilities f WHERE f.place_id=p.id) names)
WHERE p.uw_map_object_id IS NOT NULL;
COMMIT;
SELECT category, count(*) AS facilities FROM public.place_facilities
GROUP BY category ORDER BY category;
"""
    )


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("--catalog", type=Path, default=Path("data/uw-buildings/buildings.json"))
    args.add_argument("--output", type=Path, default=Path("data/uw-buildings"))
    options = args.parse_args()
    buildings = json.loads(options.catalog.read_text())
    rows = asyncio.run(collect(buildings))
    options.output.mkdir(parents=True, exist_ok=True)
    output = {
        "source": BASE,
        "collected_at": datetime.now(UTC).isoformat(),
        "buildings_checked": len(buildings),
        "facilities": rows,
    }
    (options.output / "facilities.json").write_text(
        json.dumps(output, ensure_ascii=False, indent=2)
    )
    (options.output / "import-facilities.sql").write_text(import_sql(rows))
    print(f"Checked {len(buildings)} buildings; collected {len(rows)} facility entries")
    for category in sorted(CATEGORIES):
        print(category, sum(row["category"] == category for row in rows))
    print(
        "Helen C. White Hall:",
        [(r["category"], r["name"]) for r in rows if r["uw_map_object_id"] == "490"],
    )


if __name__ == "__main__":
    main()
