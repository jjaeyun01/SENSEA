import { distanceMeters, routeDistanceMeters } from './positionFusion.mjs';
export { distanceMeters } from './positionFusion.mjs';

/** Sequential GPS cues, not visual positioning or an entrance/safety verifier. */
export class Guidance {
  constructor(route) {
    this.route = route; this.step = 0; this.warned = new Set(); this.nearDestination = false;
    this.offRouteFixes = 0; this.offRouteAnnounced = false;
  }
  update(fix, now = Date.now()) {
    if (!fix || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > 10 ||
        !Number.isFinite(fix.timestamp) || now - fix.timestamp > 5000 || now < fix.timestamp ||
        !Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude)) {
      return { kind: 'uncertain', text: 'Location accuracy is too low. Guidance is paused. Please stop and check your surroundings.' };
    }
    const routeDistance = routeDistanceMeters(this.route, fix);
    const offRouteThreshold = Math.max(25, fix.accuracy * 2 + 10);
    if (routeDistance > offRouteThreshold) this.offRouteFixes++;
    else if (routeDistance <= Math.max(12, fix.accuracy + 5)) {
      this.offRouteFixes = 0; this.offRouteAnnounced = false;
    }
    if (this.offRouteFixes >= 3 && !this.offRouteAnnounced) {
      this.offRouteAnnounced = true;
      return { kind: 'off_route', distance: routeDistance, text: 'You appear to be off the planned route. Please stop while SENSEA finds a new route.' };
    }
    if (this.offRouteAnnounced) return null;
    if (this.nearDestination) return null;
    const current = this.route.steps[this.step];
    if (!current) return null;
    const distance = distanceMeters(fix, current.end);
    const next = this.route.steps[this.step + 1];
    // Require the entire accuracy radius within the trigger distance; never invent precision.
    if (!next && distance + fix.accuracy <= (this.route.arrivalTarget?.verifiedEntrance ? 5 : 8)) {
      this.nearDestination = true;
      return this.route.arrivalTarget?.verifiedEntrance
        ? { kind: 'entrance_reached', text: 'You are near the verified entrance coordinate. Stop and confirm the entrance before ending guidance.' }
        : { kind: 'near_destination', text: 'You are near the mapped building location. No verified entrance coordinate is available. Please confirm your arrival.' };
    }
    if (next && distance + fix.accuracy <= 3) {
      this.step++;
      return { kind: 'turn', text: `Near the next turn. ${next.instruction}`, step: this.step };
    }
    if (next && distance + fix.accuracy <= 10 && !this.warned.has(this.step)) {
      this.warned.add(this.step);
      return { kind: 'approaching', text: `In approximately ten meters. ${next.instruction}`, step: this.step };
    }
    return null;
  }
}

export function decodePolyline(encoded) {
  const points = [];
  let index = 0, lat = 0, lon = 0;
  function read() {
    let result = 0, shift = 0, byte;
    do {
      if (index >= encoded.length || shift > 30) throw new Error('Invalid polyline');
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new Error('Invalid polyline');
      result |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32);
    return result & 1 ? ~(result >> 1) : result >> 1;
  }
  while (index < encoded.length) {
    lat += read(); lon += read();
    points.push({ latitude: lat / 1e5, longitude: lon / 1e5 });
  }
  return points;
}
