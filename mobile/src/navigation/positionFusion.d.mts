export type PositionSource = 'gps' | 'gps+verified-vps' | 'inertial-jump-rejected' | 'gps-reacquired';

export interface NavigationPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
  source?: PositionSource;
  trusted?: boolean;
}

export interface VerifiedVisualAlignment {
  latitude: number;
  longitude: number;
  accuracy: number;
  confidence: number;
  timestamp: number;
  verified: true;
}

export function distanceMeters(
  first: Pick<NavigationPosition, 'latitude' | 'longitude'>,
  second: Pick<NavigationPosition, 'latitude' | 'longitude'>,
): number;

export function distanceToSegmentMeters(
  point: Pick<NavigationPosition, 'latitude' | 'longitude'>,
  start: Pick<NavigationPosition, 'latitude' | 'longitude'>,
  end: Pick<NavigationPosition, 'latitude' | 'longitude'>,
): number;

export function routeDistanceMeters(
  route: { encoded_polyline?: string; steps?: { encoded_polyline?: string; start?: { latitude: number; longitude: number }; end?: { latitude: number; longitude: number } }[] },
  point: Pick<NavigationPosition, 'latitude' | 'longitude'>,
  initialStep?: number,
): number;

export class PositionFusion {
  offerMotion(sample: { acceleration: number; timestamp: number }): void;
  updateGps(fix: NavigationPosition, visual?: VerifiedVisualAlignment | null): NavigationPosition;
  reset(): void;
}

export function decodePolyline(encoded: string): { latitude: number; longitude: number }[];
