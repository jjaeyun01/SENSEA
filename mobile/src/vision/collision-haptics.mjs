import { validBox } from "./crossing.mjs";
import { screenPathRelation } from "./hazard-policy.mjs";

// Image-space urgency only: no metric distance or collision probability.
export const HAPTIC_LIMITS = Object.freeze({ freshnessMs: 1000, cooldownMs: 1800 });
export const COLLISION_PATTERN = Object.freeze([0, 180, 100, 180]);
export function hasPriorityObstacle(items) {
  return Array.isArray(items) && items.slice(0, 25).some(item =>
    item?.level === "priority" && validBox(item.box) && screenPathRelation(item.box) === "direct");
}

/** One shared actuator for both detectors; no queued or automatically looping vibration. */
export class CollisionHaptics {
  constructor({ vibrate, cancel, isAllowed }) {
    this.vibrate = vibrate;
    this.cancel = cancel;
    this.isAllowed = isAllowed;
    this.reset();
  }
  reset() {
    if (this.vibratingUntil) this.cancel();
    this.sources = { base: { at: -Infinity, urgent: false }, urban: { at: -Infinity, urgent: false } };
    this.lastPulseAt = -Infinity;
    this.lastNow = -Infinity;
    this.vibratingUntil = 0;
  }
  clear(source, now = Date.now()) {
    if (this.sources[source]) this.sources[source].urgent = false;
    this.tick(now);
  }
  tick(now = Date.now()) {
    if (!this.isAllowed() || !Number.isFinite(now) || now < 0 || now < this.lastNow) {
      this.reset();
      return false;
    }
    this.lastNow = now;
    for (const state of Object.values(this.sources)) {
      const age = now - state.at;
      if (age < 0 || age > HAPTIC_LIMITS.freshnessMs) state.urgent = false;
    }
    const active = Object.values(this.sources).some(state => state.urgent);
    if (!active && this.vibratingUntil > now) this.cancel();
    if (!active || now >= this.vibratingUntil) this.vibratingUntil = 0;
    return active;
  }
  offer(source, observedAt, urgent, now = Date.now()) {
    if (!this.sources[source]) return false;
    if (!this.isAllowed() || !Number.isFinite(now) || now < 0 || now < this.lastNow) {
      this.reset();
      return false;
    }
    this.tick(now);
    const state = this.sources[source];
    // Reordered frames must not clear a newer cue or manufacture a fresh pulse.
    if (Number.isFinite(observedAt) && observedAt <= state.at) return false;
    const age = now - observedAt;
    if (!Number.isFinite(observedAt) || age < 0 || age > HAPTIC_LIMITS.freshnessMs) {
      this.clear(source, now);
      return false;
    }
    state.at = observedAt;
    state.urgent = urgent === true;
    this.tick(now);
    if (!state.urgent || now - this.lastPulseAt < HAPTIC_LIMITS.cooldownMs) return false;
    this.vibrate([...COLLISION_PATTERN], false);
    this.lastPulseAt = now;
    this.vibratingUntil = now + COLLISION_PATTERN.reduce((sum, ms) => sum + ms, 0);
    return true;
  }
}
