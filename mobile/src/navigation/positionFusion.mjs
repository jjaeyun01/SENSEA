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

export function routeDistanceMeters(route, point, initialStep = 0) {
  const segments = [];
  const remaining = (route.steps ?? []).slice(Math.max(0, initialStep));
  for (const step of remaining) {
    if (step.start && step.end) segments.push([step.start, step.end]);
  }
  const finalEnd = remaining[remaining.length - 1]?.end;
  if (finalEnd && route.arrivalTarget &&
      Number.isFinite(route.arrivalTarget.latitude) && Number.isFinite(route.arrivalTarget.longitude)) {
    segments.push([finalEnd, route.arrivalTarget]);
  }
  if (!segments.length) return Infinity;
  return Math.min(...segments.map(([start, end]) => distanceToSegmentMeters(point, start, end)));
}

/**
 * Conservative position filter. Motion data is used to reject implausible GPS jumps,
 * not to invent a location. A visual correction is accepted only when an external
 * VPS provider marks it verified and it agrees with a recent GPS fix.
 */
export class PositionFusion {
  constructor() { this.last = null; this.motion = null; }
  offerMotion(sample) {
    if (!sample || !Number.isFinite(sample.timestamp) || !Number.isFinite(sample.acceleration)) return;
    this.motion = sample;
  }
  updateGps(fix, visual = null) {
    if (!fix || !Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude) ||
        !Number.isFinite(fix.timestamp) || !Number.isFinite(fix.accuracy) || fix.accuracy < 0) return fix;
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
      const maximum = stationary ? Math.max(8, candidate.accuracy + this.last.accuracy) : Math.max(25, elapsed * 4 + candidate.accuracy);
      if (jump > maximum) {
        const rejected = { ...this.last, timestamp: candidate.timestamp,
          accuracy: Math.max(candidate.accuracy, this.last.accuracy), source: 'inertial-jump-rejected' };
        this.last = rejected;
        return rejected;
      }
      const weight = candidate.accuracy <= 5 ? 0.8 : 0.55;
      candidate = { ...candidate,
        latitude: this.last.latitude * (1 - weight) + candidate.latitude * weight,
        longitude: this.last.longitude * (1 - weight) + candidate.longitude * weight,
      };
    }
    this.last = candidate;
    return candidate;
  }
  reset() { this.last = null; this.motion = null; }
}
