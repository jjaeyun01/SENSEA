import { distanceMeters, routeDistanceMeters, distanceToSegmentMeters, stepPoints } from './positionFusion.mjs';
export { distanceMeters } from './positionFusion.mjs';

/** Sequential GPS cues, not visual positioning or an entrance/safety verifier. */
export class Guidance {
  constructor(route, initialStep = 0) {
    this.route = route; this.step = Math.max(0, Math.min(initialStep, Math.max(0, (route.steps?.length ?? 1) - 1)));
    this.turnFixes = 0; this.turnSince = null;
    this.warned = new Set(); this.nearDestination = false;
    this.offRouteFixes = 0; this.offRouteSince = null; this.offRouteAnnounced = false;
    this.arrivalFixes = 0; this.arrivalSince = null;
    this.lastCountedFixAt = -Infinity;
  }
  update(fix, now = Date.now()) {
    if (!fix || fix.trusted === false || fix.source === 'inertial-jump-rejected' || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > 10 ||
        !Number.isFinite(fix.timestamp) || now - fix.timestamp > 5000 || now < fix.timestamp ||
        !Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude)) {
      return { kind: 'uncertain', text: 'Location accuracy is too low. Guidance is paused. Please stop and check your surroundings.' };
    }
    const routeDistance = routeDistanceMeters(this.route, fix, this.step);
    const offRouteThreshold = Math.max(25, fix.accuracy * 2 + 10);
    const isNewFix = fix.timestamp > this.lastCountedFixAt;
    if (Number.isFinite(routeDistance) && routeDistance > offRouteThreshold && isNewFix) {
      this.offRouteFixes++;
      this.offRouteSince ??= fix.timestamp;
    } else if (!Number.isFinite(routeDistance) || routeDistance <= Math.max(12, fix.accuracy + 5)) {
      this.offRouteFixes = 0; this.offRouteSince = null; this.offRouteAnnounced = false;
    }
    if (isNewFix) this.lastCountedFixAt = fix.timestamp;
    if (this.offRouteFixes >= 3 && fix.timestamp - this.offRouteSince >= 1500 && !this.offRouteAnnounced) {
      this.offRouteAnnounced = true;
      return { kind: 'off_route', distance: routeDistance, text: 'You appear to be off the planned route. Please stop while SENSEA finds a new route.' };
    }
    if (this.offRouteAnnounced) return null;
    if (this.nearDestination) return null;
    const current = this.route.steps[this.step];
    if (!current) return null;
    const next = this.route.steps[this.step + 1];
    const stepTarget = !next && this.route.arrivalTarget ? this.route.arrivalTarget : current.end;
    const distance = distanceMeters(fix, stepTarget);
    // Require the entire accuracy radius within the trigger distance; never invent precision.
    const targetAccuracy = this.route.arrivalTarget?.verifiedEntrance &&
      Number.isFinite(this.route.arrivalTarget?.accuracyM) ? this.route.arrivalTarget.accuracyM : 0;
    const arrivalRadius = this.route.arrivalTarget?.verifiedEntrance ? 10 : 12;
    if (!next && distance + fix.accuracy + targetAccuracy <= arrivalRadius) {
      if (isNewFix) {
        this.arrivalFixes++;
        this.arrivalSince ??= fix.timestamp;
      }
      // A single noisy point must never become an arrival decision.
      if (this.arrivalFixes >= 3 && fix.timestamp - this.arrivalSince >= 1500) {
        this.nearDestination = true;
        return this.route.arrivalTarget?.verifiedEntrance
          ? { kind: 'entrance_reached', text: 'You are near the verified entrance coordinate. Stop and confirm the entrance before ending guidance.' }
          : { kind: 'near_destination', text: 'You are near the mapped building location. No verified entrance coordinate is available. Please confirm your arrival.' };
      }
    } else if (!next) {
      this.arrivalFixes = 0; this.arrivalSince = null;
    }
    if (next) {
      const nextPoints = stepPoints(next);
      const nextDistance = nextPoints.length > 1 ? Math.min(...nextPoints.slice(1).map((end, i) => distanceToSegmentMeters(fix, nextPoints[i], end))) : Infinity;
      const nearTurn = distance <= Math.max(8, fix.accuracy);
      // A consistent fix near the waypoint or a short distance along the next
      // segment is evidence of progress, not a claim of three-metre precision.
      const enteredNext = distance > Math.max(8, fix.accuracy) && distance <= 30 && nextDistance <= 6 &&
        distanceMeters(fix, next.end) < distanceMeters(current.end, next.end) - 5;
      if ((nearTurn || enteredNext) && isNewFix) {
        this.turnFixes++; this.turnSince ??= fix.timestamp;
      } else if (!nearTurn && !enteredNext) { this.turnFixes = 0; this.turnSince = null; }
      if (this.turnFixes >= 3 && fix.timestamp - this.turnSince >= 1500) {
        this.step++; this.turnFixes = 0; this.turnSince = null;
        return { kind: 'turn', text: `Near the next turn. ${next.instruction}`, step: this.step };
      }
    }
    if (next && distance + fix.accuracy <= 10 && !this.warned.has(this.step)) {
      this.warned.add(this.step);
      return { kind: 'approaching', text: `In approximately ten meters. ${next.instruction}`, step: this.step };
    }
    return null;
  }

  clearOffRoute() {
    this.offRouteFixes = 0; this.offRouteSince = null; this.offRouteAnnounced = false;
  }

  clearArrival() {
    this.nearDestination = false; this.arrivalFixes = 0; this.arrivalSince = null;
  }
}

export { decodePolyline } from './positionFusion.mjs';
