import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ArrivalTarget, Place, Point, Route } from './campusApi';
import { distanceMeters } from './positionFusion.mjs';

const DIRECTORY_KEY = 'sensea:offline:directory:v1';
const ROUTE_PREFIX = 'sensea:offline:route:v1:';
const ROUTE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ROUTE_MAX_ORIGIN_DISTANCE_M = 200;

type CachedRoute = {
  savedAt: number;
  destination: Pick<Place, 'id' | 'name'>;
  origin: Point;
  routes: Route[];
  arrivalTarget?: ArrivalTarget;
};

function validPoint(value: unknown): value is Point {
  if (!value || typeof value !== 'object') return false;
  const point = value as Point;
  return Number.isFinite(point.latitude) && Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180;
}

function validPlace(value: unknown): value is Place {
  if (!value || typeof value !== 'object') return false;
  const place = value as Place;
  return typeof place.id === 'string' && /^\d+$/.test(place.id) &&
    typeof place.name === 'string' && place.name.trim().length > 0 &&
    (place.latitude === undefined || validPoint(place));
}

function validRoute(value: unknown): value is Route {
  if (!value || typeof value !== 'object') return false;
  const route = value as Route;
  return typeof route.id === 'string' && Number.isFinite(route.distance_m) && route.distance_m >= 0 &&
    Number.isFinite(route.duration_seconds) && route.duration_seconds >= 0 &&
    typeof route.encoded_polyline === 'string' && Array.isArray(route.steps) && route.steps.length > 0 &&
    route.steps.every(step => typeof step?.instruction === 'string' && validPoint(step.start) && validPoint(step.end));
}

export async function saveDirectoryCache(places: Place[]) {
  const safe = places.filter(validPlace);
  if (safe.length) await AsyncStorage.setItem(DIRECTORY_KEY, JSON.stringify({ savedAt: Date.now(), places: safe }));
}

export async function loadDirectoryCache(): Promise<Place[]> {
  try {
    const raw = await AsyncStorage.getItem(DIRECTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { places?: unknown[] };
    return Array.isArray(parsed.places) ? parsed.places.filter(validPlace) : [];
  } catch {
    return [];
  }
}

export async function saveRouteCache(destination: Place, origin: Point, routes: Route[], arrivalTarget?: ArrivalTarget) {
  if (!validPoint(origin) || !routes.length || !routes.every(validRoute)) return;
  const value: CachedRoute = {
    savedAt: Date.now(), destination: { id: destination.id, name: destination.name }, origin,
    routes, ...(arrivalTarget ? { arrivalTarget } : {}),
  };
  await AsyncStorage.setItem(`${ROUTE_PREFIX}${destination.id}`, JSON.stringify(value));
}

export async function loadRouteCache(destination: Place, origin: Point): Promise<CachedRoute | null> {
  try {
    const raw = await AsyncStorage.getItem(`${ROUTE_PREFIX}${destination.id}`);
    if (!raw) return null;
    const value = JSON.parse(raw) as CachedRoute;
    if (!Number.isFinite(value.savedAt) || Date.now() - value.savedAt > ROUTE_MAX_AGE_MS ||
        value.destination?.id !== destination.id || !validPoint(value.origin) || !validPoint(origin) ||
        distanceMeters(value.origin, origin) > ROUTE_MAX_ORIGIN_DISTANCE_M ||
        !Array.isArray(value.routes) || !value.routes.length || !value.routes.every(validRoute)) return null;
    return value;
  } catch {
    return null;
  }
}

export async function clearOfflineCache() {
  const keys = await AsyncStorage.getAllKeys();
  const owned = keys.filter(key => key === DIRECTORY_KEY || key.startsWith(ROUTE_PREFIX));
  if (owned.length) await AsyncStorage.multiRemove(owned);
}
