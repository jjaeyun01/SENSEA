import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { HazardTracker, HazardAnnouncementGate } from "../hazards.mjs";
import { HAZARD_TARGETS, HAZARD_COVERAGE, getHazardProfile, screenPathRelation } from "../hazard-policy.mjs";
const box = (x, y, w, h = w) => ({ left: x - w / 2, right: x + w / 2, top: y - h / 2, bottom: y + h / 2 });
const object = (label, b, score = 0.9) => ({ label, score, box: b });
const frame = (at, detections) => ({ receivedAt: at, quality: { status: "usable", reason: null }, detections });
const observe = (tracker, detections, count = 2) => {
  let result;
  for (let i = 0; i < count; i++) result = tracker.update(frame(i * 200, detections), i * 200);
  return result;
};
test("capabilities match the actual packaged label vocabulary without invented class aliases", () => {
  const labels = JSON.parse(readFileSync(new URL("../../../assets/models/labels.json", import.meta.url)));
  for (const target of HAZARD_TARGETS.filter(t => t.supported)) assert.ok(labels.includes(target.label), target.label);
  assert.equal(HAZARD_COVERAGE.length, 4);
  for (const kind of ["elevation", "overhead"]) assert.equal(HAZARD_COVERAGE.find(t => t.kind === kind).supported, "");
  for (const name of ["flowerbed", "e_scooter", "utility_pole", "streetlight", "stairs_down", "open_manhole", "low_branch", "awning"])
    assert.equal(getHazardProfile(name), undefined);
});
test("screen corridor distinguishes central, adjacent and side observations without depth", () => {
  assert.equal(screenPathRelation(box(0.5, 0.75, 0.08, 0.30)), "direct");
  assert.equal(screenPathRelation(box(0.22, 0.65, 0.10)), "offset");
  assert.equal(screenPathRelation(box(0.08, 0.68, 0.12)), "side");
  assert.equal(screenPathRelation(box(0.5, 0.15, 0.15)), "unknown");
});
test("a side bench is informational and never consumes automatic warning speech", () => {
  const value = observe(new HazardTracker(), [object("bench", box(0.10, 0.65, 0.16, 0.30))]);
  assert.equal(value.status, "notice");
  assert.equal(value.warningCount, 0);
  assert.equal(value.confirmedCount, 1);
  assert.equal(value.hazards[0].kind, "static");
  assert.equal(value.hazards[0].distance, "unknown");
  assert.equal(value.hazards[0].distanceMeters, null);
  assert.equal(value.hazards[0].pathInterference, "unknown");
  assert.equal(value.navigation_safe, false);
  const gate = new HazardAnnouncementGate();
  assert.equal(gate.offer(value, 200), null);
  assert.equal(gate.getDiagnostics().entryCount, 0);
  assert.doesNotMatch(value.summary + value.guidance, /안전합니다|길이 비어|우회하세요|미터/);
});
test("a large central static blocker reaches priority after two strong observations", () => {
  const tracker = new HazardTracker(), detections = [object("bench", box(0.50, 0.67, 0.58, 0.54))];
  assert.equal(observe(tracker, detections).status, "priority");
  const value = tracker.update(frame(400, detections), 400);
  assert.equal(value.status, "priority");
  assert.ok(value.hazards[0].reasons.includes("strong_static_obstruction"));
  assert.equal(value.action, "check_priority");
  assert.equal(value.hazards[0].mobility, "usually_static");
});
test("narrow lower obstacles are not rejected solely because their image area is small", () => {
  const value = observe(new HazardTracker(), [object("fire hydrant", box(0.5, 0.76, 0.06, 0.36))]);
  assert.equal(value.status, "priority");
  assert.equal(value.hazards[0].screenRelation, "direct");
});
test("people and dogs entering the central image region receive directional motion evidence", () => {
  for (const label of ["person", "dog"]) {
    const tracker = new HazardTracker(); let value;
    [0.17, 0.23, 0.29].forEach((x, index) => value = tracker.update(frame(index * 200, [object(label, box(x, 0.65, 0.28, 0.44))]), index * 200));
    assert.equal(value.status, "priority", label);
    assert.equal(value.hazards[0].motion, "toward_center");
    assert.equal(value.hazards[0].mobility, "dynamic_capable");
    const speech = new HazardAnnouncementGate().offer(value, 400);
    if (label === "person") assert.equal(speech, null);
    else assert.match(speech, /화면 중앙 쪽/);
    assert.doesNotMatch(value.summary, /다가오|충돌까지|미터|접근 속도/);
  }
});
test("outward movement is not mislabeled as entry or a critical approach", () => {
  const tracker = new HazardTracker(); let value;
  [0.29, 0.23, 0.17].forEach((x, index) => value = tracker.update(frame(index * 200, [object("person", box(x, 0.65, 0.28, 0.44))]), index * 200));
  assert.notEqual(value.status, "priority");
  assert.ok(value.hazards.every(h => h.motion !== "toward_center"));
});
test("scene-wide camera pan does not become a pedestrian moving toward the screen centre", () => {
  const tracker = new HazardTracker(); let value;
  for (let i = 0; i < 3; i++) {
    value = tracker.update(frame(i * 200, [
      object("person", box(0.17 + i * 0.06, 0.65, 0.28, 0.44)),
      object("bicycle", box(0.48 + i * 0.06, 0.65, 0.28, 0.44)),
      object("dog", box(0.65 + i * 0.06, 0.65, 0.28, 0.44)),
    ]), i * 200);
  }
  assert.ok(value.hazards.every(h => h.motion !== "toward_center" && !h.reasons.includes("peripheral_motion")));
});
test("notice to caution escalation produces a warning and priority stays above side observations", () => {
  const gate = new HazardAnnouncementGate(), tracker = new HazardTracker();
  const notice = observe(tracker, [object("bench", box(0.1, 0.65, 0.16, 0.3))]);
  assert.equal(gate.offer(notice, 200), null);
  const warning = observe(new HazardTracker(), [object("dog", box(0.5, 0.7, 0.3, 0.3))]);
  assert.match(gate.offer({ ...warning, observedAt: 400 }, 400), /^주의/);
  const ranked = observe(new HazardTracker(), [object("truck", box(0.5, 0.65, 0.5), 0.86), object("bench", box(0.10, 0.65, 0.16, 0.3), 0.99)]);
  assert.equal(ranked.hazards[0].level, "priority");
  assert.equal(ranked.hazards[1].level, "notice");
  assert.equal(ranked.warningCount, 1);
  assert.ok(ranked.hazards[0].priorityScore > ranked.hazards[1].priorityScore);
});
test("returned boxes cannot mutate tracked evidence and unavailable results have no movement instruction", () => {
  const tracker = new HazardTracker();
  const value = observe(tracker, [object("person", box(0.5, 0.7, 0.3))]);
  value.hazards[0].box.left = 0.99;
  const replay = tracker.update(frame(200, []), 201);
  assert.equal(replay.hazards[0].box.left, 0.35);
  const empty = tracker.update(frame(1401, []), 1401);
  assert.equal(empty.status, "observing");
  assert.equal(empty.navigation_safe, false);
  const missing = tracker.update({ ...frame(1601, []), quality: { status: "retake", reason: "too_dark" } }, 1601);
  assert.equal(missing.action, "unavailable");
  assert.equal(missing.warningCount, 0);
});
