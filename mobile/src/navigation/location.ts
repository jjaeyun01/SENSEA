import * as Location from 'expo-location';

export type LocationResult =
  | { ok: true; latitude: number; longitude: number; accuracyMeters: number | null }
  | { ok: false; reason: string };

export async function getCurrentLocation(): Promise<LocationResult> {
  const servicesEnabled = await Location.hasServicesEnabledAsync();
  if (!servicesEnabled) return { ok: false, reason: '기기의 위치 서비스가 꺼져 있습니다.' };

  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') {
    return { ok: false, reason: '위치 권한이 허용되지 않았습니다. 모의 안내로 진행합니다.' };
  }

  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      ok: true,
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyMeters: position.coords.accuracy,
    };
  } catch {
    return { ok: false, reason: '현재 위치를 확인할 수 없습니다. 모의 안내로 진행합니다.' };
  }
}

