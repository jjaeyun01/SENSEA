import { isSupabaseConfigured, supabase } from '../auth/supabase';
import { getCampusPlace, searchCampusPlaces, type Place } from './campusApi';

type DirectoryRow = {
  uw_map_object_id: string;
  building_name: string;
  street_address: string | null;
  latitude: number;
  longitude: number;
  facility_name: string | null;
  facility_category: string | null;
};

let cache: Place[] | null = null;
let pending: Promise<Place[]> | null = null;

function parseRows(rows: DirectoryRow[]): Place[] {
  const results: Place[] = [];
  const buildings = new Set<string>();
  const facilities = new Set<string>();
  for (const row of rows) {
    if (!/^\d+$/.test(row.uw_map_object_id) || !Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) continue;
    if (!buildings.has(row.uw_map_object_id)) {
      buildings.add(row.uw_map_object_id);
      results.push({ id: row.uw_map_object_id, name: row.building_name, address: row.street_address,
        latitude: row.latitude, longitude: row.longitude, source: 'uw' });
    }
    if (row.facility_name && row.facility_name !== row.building_name) {
      const facilityKey = `${row.uw_map_object_id}:${row.facility_name.toLocaleLowerCase()}`;
      if (facilities.has(facilityKey)) continue;
      facilities.add(facilityKey);
      results.push({ id: row.uw_map_object_id, name: row.facility_name, address: row.street_address,
        buildingName: row.building_name, facilityCategory: row.facility_category ?? undefined,
        latitude: row.latitude, longitude: row.longitude, source: 'uw' });
    }
  }
  return results;
}

export async function campusDirectory(): Promise<Place[]> {
  if (!isSupabaseConfigured) throw new Error('Supabase is not configured in mobile/.env.');
  if (cache) return cache;
  pending ??= (async () => {
    const { data, error } = await supabase.rpc('sensea_uw_directory');
    if (error) throw new Error(`Campus directory unavailable: ${error.message}`);
    if (!Array.isArray(data)) throw new Error('Campus directory returned invalid data.');
    const places = parseRows(data as DirectoryRow[]);
    if (!places.length) throw new Error('Campus directory is empty.');
    cache = places;
    return places;
  })().finally(() => { pending = null; });
  return pending;
}

export async function searchDirectory(query: string, signal?: AbortSignal): Promise<Place[]> {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length < 2) return [];
  let directory: Place[];
  try { directory = await campusDirectory(); }
  catch {
    // UW's live building search remains usable if the Supabase directory is down.
    return searchCampusPlaces(query, signal ?? new AbortController().signal);
  }
  return directory.filter(place => place.name.toLocaleLowerCase().includes(needle))
    .sort((a, b) => Number(b.name.toLocaleLowerCase() === needle) - Number(a.name.toLocaleLowerCase() === needle) ||
      Number(b.name.toLocaleLowerCase().startsWith(needle)) - Number(a.name.toLocaleLowerCase().startsWith(needle)) ||
      a.name.localeCompare(b.name))
    .slice(0, 30);
}

export async function directoryPlace(id: string, name?: string, signal?: AbortSignal): Promise<Place | null> {
  try {
    const directory = await campusDirectory();
    const match = directory.find(place => place.id === id && place.name === name) ??
      directory.find(place => place.id === id && !place.buildingName);
    if (match) return name && match.name !== name ? { ...match, name, buildingName: match.name } : match;
  } catch { /* Use the live building lookup below. */ }
  const building = await getCampusPlace(id, signal ?? new AbortController().signal);
  // Facility entries share a building ID. Preserve the user's requested
  // facility name while making the representative building explicit.
  return name && name !== building.name ? { ...building, name, buildingName: building.name } : building;
}

export async function campusSuggestions(limit = 8): Promise<Place[]> {
  const directory = await campusDirectory();
  return directory.filter(place => !place.buildingName).sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
}
