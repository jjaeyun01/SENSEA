export type Point = { latitude: number; longitude: number };
export type ArrivalTarget = Point & { verifiedEntrance: boolean; kind: 'verified_entrance' | 'building_representative_point'; accuracyM?: number | null; surveyedAt?: string | null; description?: string | null };
export type Place = { id: string; name: string; address?: string | null; source?: 'uw' | 'demo'; buildingName?: string; facilityCategory?: string; entrance?: (Point & { accuracyM: number; surveyedAt: string; description: string }) | null; entranceVerified?: boolean } & Partial<Point>;
export type Route = { id: string; label?: string; distance_m: number; duration_seconds: number; encoded_polyline: string;
  source?: 'google' | 'demo'; hasStairs?: boolean; noiseStatus?: 'fresh' | 'stale' | 'unknown';
  relativeNoise?: number; noiseCellCount?: number; noiseMeasurementCount?: number; noiseContributorCount?: number;
  noiseCoverage?: number;
  conditions?: { verified: boolean; mappedMeters?: number; moderateSlopeMeters?: number; steepSlopeMeters?: number; unpavedMeters?: number; stairsCount?: number; obstructionCount?: number; mixedTrafficMeters?: number; unprotectedCrossings?: number; litMeters?: number; unlitMeters?: number; construction?: boolean; closed?: boolean };
  arrivalTarget?: ArrivalTarget;
  warnings: string[]; steps: { encoded_polyline?: string; instruction: string; start: Point; end: Point; distance_m?: number }[] };
export const baseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL ?? process.env.EXPO_PUBLIC_API_URL)?.replace(/\/$/, '');

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`The server returned an invalid building ${field}.`);
  return value.trim();
}

function buildingId(value: unknown) {
  const id = requiredString(value, 'ID');
  if (!/^\d+$/.test(id)) throw new Error('The server returned an invalid building ID.');
  return id;
}

function coordinate(value: unknown, field: 'latitude' | 'longitude') {
  const limit = field === 'latitude' ? 90 : 180;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -limit || value > limit) {
    throw new Error(`The server returned an invalid building ${field}.`);
  }
  return value;
}

export function parseCampusSearchResponse(value: unknown): Place[] {
  if (!isObject(value) || !Array.isArray(value.places)) throw new Error('The server returned an invalid building search response.');
  return value.places.map(item => {
    if (!isObject(item)) throw new Error('The server returned an invalid building search result.');
    return { id: buildingId(item.id), name: requiredString(item.name, 'name'), source: 'uw' as const };
  });
}

export function parseCampusPlaceResponse(value: unknown): Place {
  if (!isObject(value)) throw new Error('The server returned invalid building details.');
  if (value.address !== null && value.address !== undefined && typeof value.address !== 'string') {
    throw new Error('The server returned an invalid building address.');
  }
  let entrance: Place['entrance'] = null;
  if (value.entrance !== null && value.entrance !== undefined) {
    if (!isObject(value.entrance)) throw new Error('The server returned an invalid entrance coordinate.');
    if (typeof value.entrance.accuracy_m !== 'number' || !Number.isFinite(value.entrance.accuracy_m) || value.entrance.accuracy_m <= 0 || value.entrance.accuracy_m > 10 ||
        typeof value.entrance.surveyed_at !== 'string' || !value.entrance.surveyed_at ||
        typeof value.entrance.description !== 'string' || !value.entrance.description.trim()) {
      throw new Error('The server returned unverified entrance metadata.');
    }
    entrance = { latitude: coordinate(value.entrance.latitude, 'latitude'), longitude: coordinate(value.entrance.longitude, 'longitude'),
      accuracyM: value.entrance.accuracy_m, surveyedAt: value.entrance.surveyed_at, description: value.entrance.description.trim() };
  }
  return {
    id: buildingId(value.id),
    name: requiredString(value.name, 'name'),
    address: typeof value.address === 'string' && value.address.trim() ? value.address.trim() : null,
    latitude: coordinate(value.latitude, 'latitude'),
    longitude: coordinate(value.longitude, 'longitude'),
    entrance,
    entranceVerified: value.entrance_verified === true && entrance !== null,
    source: 'uw',
  };
}

export async function request<T = unknown>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
  if (!baseUrl) throw new Error('Set the SENSEA server address in mobile/.env first.');
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { signal, method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.EXPO_PUBLIC_API_TOKEN ? { 'X-Sensea-Token': process.env.EXPO_PUBLIC_API_TOKEN } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error('Could not connect to the SENSEA server. Check the server address and network.');
  }
  let result: unknown;
  try {
    result = JSON.parse(await response.text());
  } catch {
    throw new Error('The SENSEA server returned an unreadable response.');
  }
  if (!response.ok) {
    const detail = isObject(result) && typeof result.detail === 'string' ? result.detail : null;
    throw new Error(detail ?? 'The request failed. Please try again.');
  }
  return result as T;
}

export async function searchCampusPlaces(query: string, signal: AbortSignal) {
  const result = await request(`/campus/places?q=${encodeURIComponent(query.trim())}`, signal);
  return parseCampusSearchResponse(result);
}

export async function getCampusPlace(placeId: string, signal: AbortSignal) {
  const id = buildingId(placeId);
  const result = await request(`/campus/places/${encodeURIComponent(id)}`, signal);
  const place = parseCampusPlaceResponse(result);
  if (place.id !== id) throw new Error('The server returned details for a different building.');
  return place;
}
