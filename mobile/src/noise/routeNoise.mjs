import { decodePolyline } from '../navigation/guidance.mjs';

function distanceMeters(a, b) {
  const radius = 6371000;
  const lat1 = a.latitude * Math.PI / 180;
  const lat2 = b.latitude * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLon = (b.longitude - a.longitude) * Math.PI / 180;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(value));
}

export function routeNoiseSummary(encodedPolyline, cells, radiusMeters = 60) {
  let points;
  try { points = decodePolyline(encodedPolyline); } catch { return null; }
  if (!points.length || !cells.length) return null;
  const matched = cells.filter(cell => points.some(point => distanceMeters(point, {
    latitude: cell.grid_latitude, longitude: cell.grid_longitude,
  }) <= radiusMeters));
  if (!matched.length) return null;
  const totalWeight = matched.reduce((sum, cell) => sum + Math.min(20, Math.max(1, cell.measurement_count)), 0);
  return {
    relativeNoise: matched.reduce((sum, cell) => sum + cell.average_relative_noise * Math.min(20, Math.max(1, cell.measurement_count)), 0) / totalWeight,
    cellCount: matched.length,
    measurementCount: matched.reduce((sum, cell) => sum + cell.measurement_count, 0),
  };
}
