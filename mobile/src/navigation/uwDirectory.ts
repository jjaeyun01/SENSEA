import { isSupabaseConfigured, supabase } from '../auth/supabase';
import { getCampusPlace, searchCampusPlaces, type Place } from './campusApi';
import { loadDirectoryCache, saveDirectoryCache } from './offlineCache';

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

const OFFLINE_CAMPUS_PLACES: Place[] = [
  { id: '348', name: 'Bascom Hall', address: '500 Lincoln Dr.', latitude: 43.075346, longitude: -89.404336, source: 'uw' },
  { id: '378', name: 'Engineering Hall', address: '1415 Engineering Dr.', latitude: 43.071775, longitude: -89.410325, source: 'uw' },
  { id: '470', name: 'Camp Randall Stadium', address: '1440 Monroe St.', latitude: 43.070036, longitude: -89.41267, source: 'uw' },
  { id: '431', name: 'Memorial Library', address: '728 State St.', latitude: 43.075362, longitude: -89.397979, source: 'uw' },
  { id: '432', name: 'Memorial Union', address: '800 Langdon St.', latitude: 43.076421, longitude: -89.399914, source: 'uw' },
  { id: '647', name: 'Union South', address: '1308 W Dayton St', latitude: 43.071856, longitude: -89.408074, source: 'uw' },
  { id: '489', name: 'Wendt Commons', address: '215 N. Randall Ave.', latitude: 43.071467, longitude: -89.408653, source: 'uw' },
];

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
  if (cache) return cache;
  pending ??= (async () => {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase.rpc('sensea_uw_directory');
      if (!error && Array.isArray(data)) {
        const places = parseRows(data as DirectoryRow[]);
        if (places.length) {
          cache = places;
          void saveDirectoryCache(places).catch(() => {});
          return places;
        }
      }
    }
    const saved = await loadDirectoryCache();
    cache = saved.length ? saved : OFFLINE_CAMPUS_PLACES;
    return cache;
  })().finally(() => { pending = null; });
  return pending;
}

export async function searchDirectory(query: string, signal?: AbortSignal): Promise<Place[]> {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length < 2) return [];
  let directory: Place[];
  directory = await campusDirectory();
  const local = directory.filter(place => place.name.toLocaleLowerCase().includes(needle))
    .sort((a, b) => Number(b.name.toLocaleLowerCase() === needle) - Number(a.name.toLocaleLowerCase() === needle) ||
      Number(b.name.toLocaleLowerCase().startsWith(needle)) - Number(a.name.toLocaleLowerCase().startsWith(needle)) ||
      a.name.localeCompare(b.name))
    .slice(0, 30);
  if (local.length) return local;
  try { return await searchCampusPlaces(query, signal ?? new AbortController().signal); }
  catch { return []; }
}

export async function directoryPlace(id: string, name?: string, signal?: AbortSignal): Promise<Place | null> {
  try {
    const directory = await campusDirectory();
    const match = directory.find(place => place.id === id && place.name === name) ??
      directory.find(place => place.id === id && !place.buildingName);
    if (match) return name && match.name !== name ? { ...match, name, buildingName: match.name } : match;
  } catch { /* Use the live building lookup below. */ }
  const cached = (await loadDirectoryCache()).find(place => place.id === id) ?? OFFLINE_CAMPUS_PLACES.find(place => place.id === id);
  let building: Place;
  try { building = await getCampusPlace(id, signal ?? new AbortController().signal); }
  catch (error) {
    if (!cached) throw error;
    building = cached;
  }
  // Facility entries share a building ID. Preserve the user's requested
  // facility name while making the representative building explicit.
  return name && name !== building.name ? { ...building, name, buildingName: building.name } : building;
}

export async function campusSuggestions(limit = 8): Promise<Place[]> {
  const directory = await campusDirectory();
  return directory.filter(place => !place.buildingName).sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
}
