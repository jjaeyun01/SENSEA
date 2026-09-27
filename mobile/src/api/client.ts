export type Place = { id: string; name: string; latitude: number; longitude: number; entrance_waypoint: string; entrance_notes: string; verification_status: 'demo' | 'verified' | 'unknown' };
export type RouteSegment = { edge_id: string; from: string; to: string; distance_m: number; instruction: string; pedestrian_verified: true };
export type RouteOption = { id: string; label: string; distance_m: number; relative_noise: number | null; noise_data_status: 'measured' | 'stale' | 'unknown'; noise_freshness_minutes: number | null; segments: RouteSegment[] };
export type VisionResult = { description: string; recognized_text: string | null; uncertainty: number; provider_mode: string; image_retained: false };

export const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') ?? 'http://127.0.0.1:8000';

export class ApiError extends Error {}

async function apiFetch(path: string, init?: RequestInit, timeoutMs = 6000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_URL}${path}`, { ...init, signal: controller.signal });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { detail?: string };
      throw new ApiError(body.detail ?? `Request failed with status ${response.status}.`);
    }
    return response;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(`Cannot reach the SENSEA backend at ${API_URL}. Check EXPO_PUBLIC_API_URL and try again.`);
  } finally { clearTimeout(timeout); }
}

export async function searchPlaces(query: string): Promise<Place[]> {
  const response = await apiFetch(`/places?q=${encodeURIComponent(query)}`);
  return ((await response.json()) as { places: Place[] }).places;
}

export async function getRoutes(request: { start_waypoint: string; end_waypoint: string; noise_preference: 'shortest' | 'quiet' | 'active' | 'automatic'; local_hour?: number }): Promise<RouteOption[]> {
  const response = await apiFetch('/routes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  return ((await response.json()) as { routes: RouteOption[] }).routes;
}

export async function submitNoiseMeasurement(request: { edge_id: string; relative_noise: number; consent: true }): Promise<void> {
  await apiFetch('/noise', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
}

export async function describeImage(uri: string, expectedPlace?: string): Promise<VisionResult> {
  const form = new FormData();
  form.append('image', { uri, name: 'sensea-still.jpg', type: 'image/jpeg' } as unknown as Blob);
  if (expectedPlace) form.append('expected_place', expectedPlace);
  const response = await apiFetch('/vision/describe', { method: 'POST', body: form }, 15000);
  return (await response.json()) as VisionResult;
}

export async function transcribeAudio(uri: string): Promise<string> {
  const form = new FormData();
  form.append('audio', { uri, name: 'sensea-command.m4a', type: 'audio/mp4' } as unknown as Blob);
  const response = await apiFetch('/speech/transcribe', { method: 'POST', body: form }, 15000);
  return ((await response.json()) as { transcript: string }).transcript;
}
