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
  // Equidistant samples avoid over-counting places with dense polyline vertices.
  const lengths = points.slice(1).map((point, index) => distanceMeters(points[index], point));
  const length = lengths.reduce((sum, value) => sum + value, 0);
  if (length <= 0) return null;
  const sampleCount = Math.min(257, Math.max(2, Math.ceil(length / 25) + 1));
  const sampled = [];
  let segment = 0, passed = 0;
  for (let index = 0; index < sampleCount; index++) {
    const target = length * index / (sampleCount - 1);
    while (segment < lengths.length - 1 && passed + lengths[segment] < target) passed += lengths[segment++];
    const fraction = lengths[segment] ? Math.min(1, Math.max(0, (target - passed) / lengths[segment])) : 0;
    sampled.push({
      latitude: points[segment].latitude + (points[segment + 1].latitude - points[segment].latitude) * fraction,
      longitude: points[segment].longitude + (points[segment + 1].longitude - points[segment].longitude) * fraction,
    });
  }
  const nearby = (point, cell) => distanceMeters(point, {
    latitude: cell.grid_latitude, longitude: cell.grid_longitude,
  }) <= radiusMeters;
  const matched = cells.filter(cell => sampled.some(point => nearby(point, cell)));
  if (!matched.length) return null;
  const totalWeight = matched.reduce((sum, cell) => sum + Math.min(20, Math.max(1, cell.measurement_count)), 0);
  return {
    relativeNoise: matched.reduce((sum, cell) => sum + cell.average_relative_noise * Math.min(20, Math.max(1, cell.measurement_count)), 0) / totalWeight,
    cellCount: matched.length,
    measurementCount: matched.reduce((sum, cell) => sum + cell.measurement_count, 0),
    contributorCount: Math.max(...matched.map(cell => cell.contributing_users ?? 0)),
    coverageRatio: sampled.filter(point => matched.some(cell => nearby(point, cell))).length / sampled.length,
  };
}
