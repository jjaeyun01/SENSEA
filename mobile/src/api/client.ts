export type NavigationStep = {
  id: string;
  instruction: string;
  distanceMeters: number;
  priority: 0 | 1 | 2 | 3;
};

export type RouteOption = {
  id: string;
  name: string;
  summary: string;
  durationMinutes: number;
  distanceMeters: number;
  hasStairs: boolean;
  noiseLevel: '낮음' | '보통' | '높음';
  steps: NavigationStep[];
};

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8000';

const DEMO_ROUTES: RouteOption[] = [
  {
    id: 'flat-safe',
    name: '평지 위주 경로',
    summary: '계단 없이 검토된 보행로와 횡단보도를 이용합니다.',
    durationMinutes: 5,
    distanceMeters: 360,
    hasStairs: false,
    noiseLevel: '낮음',
    steps: [
      { id: 'f1', instruction: '정면 12시 방향으로 80미터 직진하세요.', distanceMeters: 80, priority: 3 },
      { id: 'f2', instruction: '10미터 앞에서 2시 방향 오른쪽 길로 이동합니다.', distanceMeters: 10, priority: 2 },
      { id: 'f3', instruction: '횡단보도 앞입니다. 신호와 주변 교통을 직접 확인하세요.', distanceMeters: 3, priority: 1 },
      { id: 'f4', instruction: '학생회관 정문 근처에 도착했습니다.', distanceMeters: 0, priority: 2 },
    ],
  },
  {
    id: 'fast',
    name: '빠른 경로',
    summary: '이동 시간은 짧지만 중간에 계단이 포함됩니다.',
    durationMinutes: 3,
    distanceMeters: 240,
    hasStairs: true,
    noiseLevel: '보통',
    steps: [
      { id: 'q1', instruction: '정면 12시 방향으로 50미터 직진하세요.', distanceMeters: 50, priority: 3 },
      { id: 'q2', instruction: '3미터 앞에 내리막 계단이 시작됩니다. 난간을 확인하세요.', distanceMeters: 3, priority: 1 },
      { id: 'q3', instruction: '계단을 내려온 뒤 9시 방향 왼쪽으로 이동하세요.', distanceMeters: 0, priority: 2 },
      { id: 'q4', instruction: '학생회관 측면 입구 근처에 도착했습니다.', distanceMeters: 0, priority: 2 },
    ],
  },
];

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 3500): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestRoutes(destination: string): Promise<{
  routes: RouteOption[];
  source: 'server' | 'demo';
}> {
  try {
    const response = await fetchWithTimeout(`${API_URL}/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination }),
    });

    if (!response.ok) throw new Error(`Route request failed with ${response.status}`);
    const data = (await response.json()) as { routes?: RouteOption[] };
    if (!Array.isArray(data.routes) || data.routes.length === 0) {
      throw new Error('No routes returned');
    }
    return { routes: data.routes, source: 'server' };
  } catch {
    return { routes: DEMO_ROUTES, source: 'demo' };
  }
}

export async function requestSceneDescription(): Promise<string> {
  try {
    const response = await fetchWithTimeout(`${API_URL}/vision/describe`, { method: 'POST' });
    if (!response.ok) throw new Error(`Vision request failed with ${response.status}`);
    const data = (await response.json()) as { description?: string };
    if (!data.description) throw new Error('No description returned');
    return data.description;
  } catch {
    return '데모 설명입니다. 정면에 건물 출입구로 보이는 문과 오른쪽 벽면의 표지판이 있습니다. 이 설명만으로 이동 안전을 판단하지 마세요.';
  }
}

