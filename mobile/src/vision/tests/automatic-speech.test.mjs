import assert from "node:assert/strict";
import test from "node:test";
import { AnnouncementGate, describeResult } from "../detection.mjs";
import { HazardTracker, HazardAnnouncementGate } from "../hazards.mjs";
import { automaticWarnings } from "../automatic-speech.mjs";
import { hasPriorityObstacle } from "../collision-haptics.mjs";

const frame = (at, labels = ["person"]) => ({
  receivedAt: at, quality: { status: "usable", reason: null },
  detections: labels.map(label => ({ label, score: .9,
    box: { left: .25, right: .75, top: .4, bottom: .95 } })),
});

test("people stay in results and manual replay while automatic descriptions remain silent", () => {
  const gate = new AnnouncementGate();
  for (const at of [0, 200, 4200, 10000]) {
    const value = frame(at), original = structuredClone(value);
    assert.equal(gate.offer(value, at), null);
    assert.deepEqual(value, original);
    assert.match(describeResult(value), /사람/);
  }
});

test("a person does not consume cooldown or interrupt a stable other-object description", () => {
  const gate = new AnnouncementGate();
  gate.offer(frame(0), 0);
  assert.equal(gate.offer(frame(200), 200), null);
  assert.equal(gate.offer(frame(400, ["person", "bench"]), 400), null);
  assert.equal(gate.offer(frame(600, ["bench"]), 600), "벤치이 보입니다.");
  assert.equal(gate.offer(frame(5000, ["person", "bench"]), 5000), null);
});

test("people do not suppress camera quality guidance", () => {
  const gate = new AnnouncementGate();
  const value = { ...frame(0), quality: { status: "retake", reason: "too_dark" } };
  assert.equal(gate.offer(value, 0), null);
  assert.match(gate.offer(value, 200), /어둡/);
});

test("a close-looking person remains a tracked priority and haptic cue without automatic speech", () => {
  const tracker = new HazardTracker(), gate = new HazardAnnouncementGate();
  let value;
  for (const at of [0, 200, 400]) {
    value = tracker.update(frame(at), at);
    assert.equal(gate.offer(value, at), null);
  }
  assert.equal(value.hazards[0].label, "person");
  assert.equal(value.hazards[0].level, "priority");
  assert.match(value.summary, /사람/);
  assert.equal(hasPriorityObstacle(value.hazards), true);
  assert.deepEqual(automaticWarnings(value), []);
  assert.equal(gate.getDiagnostics().entryCount, 0);
});

test("a higher-ranked person leaves voice priority and cooldown available to other obstacles", () => {
  const tracker = new HazardTracker(), gate = new HazardAnnouncementGate();
  let value;
  for (const at of [0, 200, 400]) {
    value = tracker.update(frame(at), at);
    assert.equal(gate.offer(value, at), null);
  }
  const other = { ...value.hazards[0], trackId: 20, label: "car", level: "caution" };
  const mixed = { ...value, observedAt: 600, hazards: [value.hazards[0], other] };
  const original = structuredClone(mixed);
  const speech = gate.offer(mixed, 600);
  assert.match(speech, /자동차/);
  assert.doesNotMatch(speech, /사람/);
  assert.deepEqual(mixed, original);
  assert.equal(automaticWarnings(mixed).some(item => item.level === "priority"), false);
  assert.equal(gate.getDiagnostics().entryCount, 1);
  assert.equal(gate.offer({ ...mixed, observedAt: 800 }, 800), null);
  assert.match(gate.offer({ ...mixed, observedAt: 1000,
    hazards: [mixed.hazards[0], { ...other, level: "priority" }] }, 1000), /^우선 주의/);
});
