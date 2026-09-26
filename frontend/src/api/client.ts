export interface Place { id: string; name: string; aliases: string[]; waypoint_id: string }
export interface NoiseSummary {
  status: 'measured' | 'stale' | 'unknown'; relative_noise: number | null;
  sample_count: number; oldest_observed_at: string | null; latest_observed_at: string | null;
}
export interface Segment {
  edge_id: string; from: string; to: string; distance_m: number; instruction: string; noise: NoiseSummary;
}
export interface Route {
  id: string; distance_m: number; relative_noise: number | null;
  noise_data_status: 'measured' | 'partial' | 'stale' | 'unknown';
  noise_coverage: number; oldest_measurement: string | null; segments: Segment[];
}
export interface RouteResponse {
  mode: 'simulation' | 'live'; routes: Route[]; recommended_route_id: string; arrived: boolean; notice: string;
}

export class SenseaApi {
  constructor(private baseUrl: string, private writeToken = '') {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 40_000);
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, { ...init, signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : `Request failed (${response.status})`);
      return body as T;
    } finally { clearTimeout(timeout); }
  }

  async places(query: string): Promise<Place[]> {
    return (await this.request<{ places: Place[] }>(`/places?q=${encodeURIComponent(query)}`)).places;
  }

  routes(start: string, end: string, preference: 'shortest' | 'quiet' = 'quiet', mode: 'simulation' | 'live' = 'simulation') {
    return this.request<RouteResponse>('/routes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_waypoint: start, end_waypoint: end, noise_preference: preference, mode }),
    });
  }

  submitNoise(edgeId: string, relativeNoise: number, consent: boolean) {
    return this.request<{ accepted: boolean; edge_id: string }>('/noise', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.writeToken}` },
      body: JSON.stringify({ edge_id: edgeId, relative_noise: relativeNoise, consent }),
    });
  }

  /** Pass the recording bytes/Blob from the frontend's chosen audio adapter. */
  transcribe(audio: Blob | ArrayBuffer, mimeType = 'audio/mp4') {
    return this.request<{ transcript: string }>('/speech/transcribe', {
      method: 'POST', headers: { 'Content-Type': mimeType, Authorization: `Bearer ${this.writeToken}` }, body: audio,
    });
  }
}
