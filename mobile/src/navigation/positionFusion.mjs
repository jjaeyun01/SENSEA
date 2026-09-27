const radians = value => value * Math.PI / 180;

export function distanceMeters(a, b) {
  const dlat = radians(b.latitude - a.latitude);
  const dlon = radians(b.longitude - a.longitude);
  const x = Math.sin(dlat / 2) ** 2 +
    Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dlon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}

function localPoint(origin, point) {
  return {
    x: radians(point.longitude - origin.longitude) * 6371000 * Math.cos(radians(origin.latitude)),
    y: radians(point.latitude - origin.latitude) * 6371000,
  };
}

export function distanceToSegmentMeters(point, start, end) {
  const a = localPoint(point, start), b = localPoint(point, end);
  const dx = b.x - a.x, dy = b.y - a.y;
  const denominator = dx * dx + dy * dy;
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / denominator));
  return Math.hypot(a.x + t * dx, a.y + t * dy);
}

// Google provides per-step geometry; never substitute the endpoint chord for it.
export function decodePolyline(encoded) {
  const points = []; let index = 0, lat = 0, lon = 0;
  function read() {
    let result = 0, shift = 0, byte;
    do {
      if (index >= encoded.length || shift > 30) throw new Error('Invalid polyline');
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new Error('Invalid polyline');
      result |= (byte & 31) << shift; shift += 5;
    } while (byte >= 32);
    return result & 1 ? ~(result >> 1) : result >> 1;
  }
  while (index < encoded.length) {
    lat += read(); lon += read();
    const point = { latitude: lat / 1e5, longitude: lon / 1e5 };
    if (Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) throw new Error('Invalid polyline');
    points.push(point);
  }
  return points;
}
export function stepPoints(step) {
  if (step?.encoded_polyline) {
    try { const points = decodePolyline(step.encoded_polyline); if (points.length >= 2) return points; }
    catch { return []; }
  }
  return step?.start && step?.end ? [step.start, step.end] : [];
}
export function routeDistanceMeters(route, point, initialStep = 0) {
  const remaining = (route.steps ?? []).slice(Math.max(0, initialStep - 1), initialStep + 3);
  let lines = remaining.map(stepPoints);
  // Older servers expose only whole-route geometry. Prefer it to endpoint chords.
  if (route.encoded_polyline && !remaining.some(step => step.encoded_polyline)) {
    try { lines = [decodePolyline(route.encoded_polyline)]; } catch { return Infinity; }
  }
  const distances = lines.flatMap(points => points.slice(1).map((end, i) => distanceToSegmentMeters(point, points[i], end)));
  const finalEnd = initialStep + 3 >= (route.steps?.length ?? 0) ? route.steps?.at(-1)?.end : null;
  if (finalEnd && route.arrivalTarget && Number.isFinite(route.arrivalTarget.latitude) && Number.isFinite(route.arrivalTarget.longitude)) {
    distances.push(distanceToSegmentMeters(point, finalEnd, route.arrivalTarget));
  }
  return distances.length ? Math.min(...distances) : Infinity;
}

/**
 * Conservative position filter. Motion data is used to reject implausible GPS jumps,
 * not to invent a location. A visual correction is accepted only when an external
 * VPS provider marks it verified and it agrees with a recent GPS fix.
 */
export class PositionFusion {
  constructor() { this.last = null; this.motion = null; this.recovery = null; this.latestGpsAt = -Infinity; }
  offerMotion(sample) {
    if (!sample || !Number.isFinite(sample.timestamp) || !Number.isFinite(sample.acceleration)) return;
    this.motion = sample;
  }
  updateGps(fix, visual = null) {
    if (!fix || !Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude) ||
        !Number.isFinite(fix.timestamp) || !Number.isFinite(fix.accuracy) || fix.accuracy < 0) return fix;
    if (fix.timestamp <= this.latestGpsAt) return this.recovery && this.last ? { ...this.last, source: 'inertial-jump-rejected', trusted: false } : this.last ?? fix;
    this.latestGpsAt = fix.timestamp;
    let candidate = { ...fix, source: 'gps' };
    if (visual?.verified === true && visual.confidence >= 0.9 &&
        Number.isFinite(visual.latitude) && Number.isFinite(visual.longitude) &&
        Math.abs(fix.timestamp - visual.timestamp) <= 2000 && distanceMeters(fix, visual) <= 15) {
      const visualWeight = Math.min(0.65, Math.max(0.35, visual.confidence - 0.3));
      candidate = {
        ...fix,
        latitude: fix.latitude * (1 - visualWeight) + visual.latitude * visualWeight,
        longitude: fix.longitude * (1 - visualWeight) + visual.longitude * visualWeight,
        accuracy: Math.max(2, Math.min(fix.accuracy, visual.accuracy ?? 5)),
        source: 'gps+verified-vps',
      };
    }
    if (this.last && candidate.timestamp > this.last.timestamp) {
      const elapsed = (candidate.timestamp - this.last.timestamp) / 1000;
      const jump = distanceMeters(this.last, candidate);
      const recentMotion = this.motion && candidate.timestamp >= this.motion.timestamp && candidate.timestamp - this.motion.timestamp <= 1500;
      const stationary = recentMotion && this.motion.acceleration < 0.12;
      const maximum = stationary ? Math.max(8, candidate.accuracy + this.last.accuracy) : Math.max(25, Math.min(elapsed, 5) * 4 + candidate.accuracy);
      if (jump > maximum) {
        const recovery = this.recovery;
        if (candidate.accuracy <= 10 && recovery && candidate.timestamp - recovery.lastAt <= 3000 &&
            distanceMeters(recovery.fix, candidate) <= Math.max(10, candidate.accuracy + recovery.fix.accuracy)) {
          recovery.count++; recovery.lastAt = candidate.timestamp;
        } else {
          this.recovery = candidate.accuracy <= 10 ? { fix: candidate, firstAt: candidate.timestamp, lastAt: candidate.timestamp, count: 1 } : null;
        }
        if (this.recovery?.count >= 3 && candidate.timestamp - this.recovery.firstAt >= 2000) {
          this.last = { ...candidate, source: 'gps-reacquired' }; this.recovery = null;
          return this.last;
        }
        // Preserve the time of the actual accepted fix and explicitly prohibit guidance.
        return { ...this.last, source: 'inertial-jump-rejected', trusted: false };
      }
      this.recovery = null;
      const weight = candidate.accuracy <= 5 ? 0.8 : 0.55;
      candidate = { ...candidate,
        latitude: this.last.latitude * (1 - weight) + candidate.latitude * weight,
        longitude: this.last.longitude * (1 - weight) + candidate.longitude * weight,
      };
    }
    this.last = candidate;
    return candidate;
  }
  reset() { this.last = null; this.motion = null; this.recovery = null; this.latestGpsAt = -Infinity; }
}
