import type { NavigationPosition } from './positionFusion.mjs';
import type { Route } from './campusApi';

export type GuidanceEvent =
  | { kind: 'uncertain'; text: string }
  | { kind: 'off_route'; text: string; distance: number }
  | { kind: 'entrance_reached' | 'near_destination'; text: string }
  | { kind: 'turn' | 'approaching'; text: string; step: number };

export class Guidance {
  readonly route: Route;
  step: number;
  constructor(route: Route, initialStep?: number);
  update(fix: NavigationPosition, now?: number): GuidanceEvent | null;
  clearOffRoute(): void;
  clearArrival(): void;
}

export function distanceMeters(
  first: Pick<NavigationPosition, 'latitude' | 'longitude'>,
  second: Pick<NavigationPosition, 'latitude' | 'longitude'>,
): number;
export function decodePolyline(encoded: string): { latitude: number; longitude: number }[];
