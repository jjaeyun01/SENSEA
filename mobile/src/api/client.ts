export type NavigationStep = {
  id: string;
  instruction: string;
  distanceMeters: number;
  priority: 0 | 1 | 2 | 3;
};

export type RouteOption = {
  id: string;
  routeType: 'shortest' | 'quiet';
  name: string;
  summary: string;
  durationMinutes: number;
  distanceMeters: number;
  hasStairs: boolean;
  noiseLevel: '낮음' | '보통' | '높음';
  verificationStatus: 'verified-demo';
  dataFreshness: string;
  uncertainty: string;
  steps: NavigationStep[];
};

export type SceneDescription = {
  description: string;
  uncertainty: '낮음' | '보통' | '높음';
  isDemo: boolean;
};

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8000';

const DEMO_ROUTES: RouteOption[] = [
  {
    id: 'flat-safe',
    routeType: 'quiet',
    name: '소음이 적은 평지 경로',
    summary: '계단 없이 검토된 보행로를 이용하며 측정 소음이 더 낮습니다.',
    durationMinutes: 5,
    distanceMeters: 360,
    hasStairs: false,
    noiseLevel: '낮음',
    verificationStatus: 'verified-demo',
    dataFreshness: '오늘 측정한 데모 데이터',
    uncertainty: '현재 공사나 일시적 장애물은 반영되지 않을 수 있습니다.',
    steps: [
      { id: 'f1', instruction: '정면 12시 방향으로 80미터 직진하세요.', distanceMeters: 80, priority: 3 },
      { id: 'f2', instruction: '10미터 앞에서 2시 방향 오른쪽 길로 이동합니다.', distanceMeters: 10, priority: 2 },
      { id: 'f3', instruction: '횡단보도 앞입니다. 신호와 주변 교통을 직접 확인하세요.', distanceMeters: 3, priority: 1 },
      { id: 'f4', instruction: '학생회관 정문 근처에 도착했습니다.', distanceMeters: 0, priority: 2 },
    ],
  },
  {
    id: 'fast',
    routeType: 'shortest',
    name: '가장 짧은 경로',
    summary: '이동 시간은 짧지만 중간에 계단이 포함됩니다.',
    durationMinutes: 3,
    distanceMeters: 240,
    hasStairs: true,
    noiseLevel: '보통',
    verificationStatus: 'verified-demo',
    dataFreshness: '오늘 확인한 데모 경로',
    uncertainty: '계단과 GPS 오차 때문에 수동 확인이 필요할 수 있습니다.',
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

export async function requestSceneDescription(): Promise<SceneDescription> {
  try {
    const response = await fetchWithTimeout(`${API_URL}/vision/describe`, { method: 'POST' });
    if (!response.ok) throw new Error(`Vision request failed with ${response.status}`);
    const data = (await response.json()) as {
      description?: string;
      uncertainty?: SceneDescription['uncertainty'];
      is_demo?: boolean;
    };
    if (!data.description) throw new Error('No description returned');
    return {
      description: data.description,
      uncertainty: data.uncertainty ?? '높음',
      isDemo: data.is_demo ?? false,
    };
  } catch {
    return {
      description: '데모 설명입니다. 정면에 건물 출입구로 보이는 문과 오른쪽 벽면의 표지판이 있습니다.',
      uncertainty: '높음',
      isDemo: true,
    };
  }
}
