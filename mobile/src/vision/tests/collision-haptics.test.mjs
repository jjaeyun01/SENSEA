import test from "node:test";
import assert from "node:assert/strict";
import { CollisionHaptics, COLLISION_PATTERN, hasPriorityObstacle } from "../collision-haptics.mjs";
import { HazardTracker } from "../hazards.mjs";
import { FacilityAttention } from "../facility-attention.mjs";

const box = { left: .25, top: .45, right: .75, bottom: .95 };
const harness = () => {
  const pulses = [], stops = [];
  let allowed = true;
  const channel = new CollisionHaptics({
    vibrate: (pattern, repeat) => pulses.push({ pattern, repeat }),
    cancel: () => stops.push(true), isAllowed: () => allowed,
  });
  return { channel, pulses, stops, allow: value => { allowed = value; } };
};
const baseFrame = (at, label = "person", b = box, score = .9) => ({
  receivedAt: at, quality: { status: "usable", reason: null }, detections: [{ label, score, box: b }],
});

test("a stationary close-looking person triggers two pulses after repeated strong observations", () => {
  const { channel, pulses } = harness(), tracker = new HazardTracker();
  for (const at of [0, 200]) {
    const value = tracker.update(baseFrame(at), at);
    assert.equal(channel.offer("base", at, hasPriorityObstacle(value.hazards), at), false);
  }
  const value = tracker.update(baseFrame(400), 400);
  assert.equal(value.status, "priority");
  assert.equal(value.hazards[0].distanceMeters, null);
  assert.equal(channel.offer("base", 400, hasPriorityObstacle(value.hazards), 400), true);
  assert.deepEqual(pulses, [{ pattern: [...COLLISION_PATTERN], repeat: false }]);
});

test("smaller, peripheral and low-confidence people do not generate close-obstacle vibration", () => {
  for (const [b, score] of [
    [{ left: .42, top: .6, right: .58, bottom: .8 }, .9],
    [{ left: .02, top: .45, right: .18, bottom: .95 }, .9], [box, .75],
  ]) {
    const tracker = new HazardTracker();
    for (const at of [0, 200, 400, 600]) {
      const value = tracker.update(baseFrame(at, "person", b, score), at);
      assert.equal(hasPriorityObstacle(value.hazards), false);
    }
  }
});

test("a recent size jump needs two large observations before close-obstacle urgency", () => {
  const tracker = new HazardTracker();
  tracker.update(baseFrame(0, "person", { left: .32, right: .68, top: .50, bottom: .92 }), 0);
  tracker.update(baseFrame(200, "person", { left: .32, right: .68, top: .50, bottom: .92 }), 200);
  const value = tracker.update(baseFrame(400), 400);
  assert.ok(!value.hazards.some(h => h.reasons.includes("strong_near_image_obstruction")));
});

test("confirmed facility priority uses the same actuator without any speech callback", () => {
  const { channel, pulses } = harness(), tracker = new FacilityAttention();
  for (const at of [0, 600, 1200]) {
    const attention = tracker.update({ receivedAt: at, quality: "usable", detections: [{ label: "trash_can", score: .4, box }] }, at);
    channel.offer("urban", at, hasPriorityObstacle(attention), at);
  }
  assert.equal(pulses.length, 1);
});

test("one global cooldown prevents both detectors and changing object IDs from flooding vibration", () => {
  const { channel, pulses } = harness();
  assert.equal(channel.offer("base", 100, true, 100), true);
  for (let at = 200; at < 1900; at += 100) {
    assert.equal(channel.offer("urban", at, true, at), false);
    assert.equal(channel.offer("base", at, true, at), false);
  }
  assert.equal(channel.offer("urban", 1900, true, 1900), true);
  assert.equal(pulses.length, 2);
});

test("no timers repeat a pulse and stale cues stop an in-progress pattern", () => {
  const { channel, pulses, stops } = harness();
  channel.offer("base", 0, true, 950);
  channel.tick(1001);
  assert.equal(stops.length, 1);
  channel.tick(4000);
  assert.equal(pulses.length, 1);
});

test("loss of the last urgent cue cancels the current pattern immediately", () => {
  const { channel, stops } = harness();
  channel.offer("base", 0, true, 0);
  channel.offer("base", 200, false, 200);
  assert.equal(stops.length, 1);
});

test("a clear frame from the other detector does not cancel a current priority cue", () => {
  const { channel, stops } = harness();
  channel.offer("base", 0, true, 0);
  channel.offer("urban", 100, false, 100);
  assert.equal(stops.length, 0);
  channel.offer("urban", 200, true, 200);
  channel.clear("base", 250);
  assert.equal(stops.length, 0);
  channel.clear("urban", 300);
  assert.equal(stops.length, 1);
});

test("replayed and reordered frames cannot retrigger or clear newer evidence", () => {
  const { channel, pulses, stops } = harness();
  channel.offer("base", 100, true, 100);
  assert.equal(channel.offer("base", 100, false, 200), false);
  assert.equal(channel.offer("base", 50, false, 250), false);
  assert.equal(stops.length, 0);
  assert.equal(channel.offer("base", 100, true, 2500), false);
  assert.equal(pulses.length, 1);
});

test("invalid timestamps, future frames, stale frames and unknown sources never vibrate", () => {
  for (const [at, now] of [[NaN, 0], [0, NaN], [100, 99], [0, 1001], [-100, -100]]) {
    const { channel, pulses } = harness();
    assert.equal(channel.offer("base", at, true, now), false);
    assert.equal(pulses.length, 0);
  }
  assert.equal(harness().channel.offer("signal", 0, true, 0), false);
});

test("disable, background or camera close cancel and prevent new vibration", () => {
  const { channel, pulses, stops, allow } = harness();
  channel.offer("base", 0, true, 0);
  allow(false);
  channel.tick(100);
  assert.equal(stops.length, 1);
  assert.equal(channel.offer("urban", 200, true, 200), false);
  allow(true);
  channel.tick(3000);
  assert.equal(pulses.length, 1);
  assert.equal(channel.offer("base", 3200, true, 3200), true);
  channel.reset();
  assert.equal(stops.length, 2);
});

test("clearing an errored source does not reset the shared cooldown", () => {
  const { channel, pulses } = harness();
  channel.offer("base", 0, true, 0);
  channel.clear("base", 100);
  assert.equal(channel.offer("urban", 200, true, 200), false);
  assert.equal(pulses.length, 1);
});

test("clock rollback cancels and does not replay a queued vibration", () => {
  const { channel, pulses, stops } = harness();
  channel.offer("base", 1000, true, 1000);
  assert.equal(channel.offer("urban", 900, true, 900), false);
  assert.equal(stops.length, 1);
  channel.tick(2000);
  assert.equal(pulses.length, 1);
});

test("ordinary boxes, side observations, invalid coordinates and non-priority results stay quiet", () => {
  for (const items of [null, [], [{ box }], [{ level: "caution", box }],
    [{ level: "priority", box: { ...box, bottom: NaN } }],
    [{ level: "priority", box: { left: .01, right: .1, top: .4, bottom: .8 } }]]) {
    assert.equal(hasPriorityObstacle(items), false);
  }
});
