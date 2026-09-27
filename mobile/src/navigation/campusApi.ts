export type Point = { latitude: number; longitude: number };
export type Place = { id: string; name: string; address?: string | null; source?: 'uw' | 'demo' } & Partial<Point>;
export type Route = { id: string; label?: string; distance_m: number; duration_seconds: number; encoded_polyline: string;
  source?: 'google' | 'demo'; hasStairs?: boolean; noiseStatus?: 'fresh' | 'stale' | 'unknown';
  relativeNoise?: number; noiseCellCount?: number; noiseMeasurementCount?: number;
  warnings: string[]; steps: { instruction: string; start: Point; end: Point; distance_m?: number }[] };
export const baseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL ?? process.env.EXPO_PUBLIC_API_URL)?.replace(/\/$/, '');
export async function request(path: string, signal: AbortSignal, body?: unknown) {
  if (!baseUrl) throw new Error('Set the SENSEA server address in mobile/.env first.');
  const response = await fetch(`${baseUrl}${path}`, { signal, method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Sensea-Token': process.env.EXPO_PUBLIC_API_TOKEN ?? '' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'The request failed. Please try again.');
  return result;
}
