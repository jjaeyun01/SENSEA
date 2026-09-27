import assert from "node:assert/strict";
import test from "node:test";
import { HazardTracker, HazardAnnouncementGate, HAZARD_LIMITS } from "../hazards.mjs";

const box = (x = 0.5, y = 0.7, w = 0.3, h = w) => ({ left: x - w / 2, right: x + w / 2, top: y - h / 2, bottom: y + h / 2 });
const detection = (label = "car", b = box(), score = 0.9) => ({ label, score, box: b });
const result = (at, detections = [detection()], quality = { status: "usable", reason: null }) => ({ receivedAt: at, quality, detections });
const update = (tracker, at, detections) => tracker.update(result(at, detections), at);
function stable(tracker, detections = [detection()], start = 0) {
  update(tracker, start, detections);
  return update(tracker, start + 200, detections);
}
function growing(tracker, options = {}) {
  const { x = 0.5, y = 0.7, label = "car", score = 0.9 } = options;
  let answer;
  for (const [index, width] of [0.26, 0.31, 0.37].entries()) {
    answer = update(tracker, index * 200, [detection(label, box(x, y, width), score)]);
  }
  return answer;
}
function assessment(at, level = "caution", id = 1, direction = "center") {
  return { status: level, summary: "unused", hazards: level === "observing" ? [] : [{
    trackId: id, label: "car", direction, level, reasons: ["stable_presence", "central_lower"],
  }], observedAt: at, navigation_safe: false };
}

test("a single detection and rapid duplicate frames never create temporal confirmation", () => {
  const tracker = new HazardTracker();
  assert.equal(update(tracker, 0).status, "observing");
  for (let now = 1; now <= 500; now++) assert.equal(tracker.update(result(0), now).status, "observing");
  assert.deepEqual(tracker.getDiagnostics(), { trackCount: 1, sampleCount: 1, maxHistory: 1 });
  assert.equal(update(tracker, 100).status, "unavailable", "clock regression clears evidence");
  assert.equal(update(tracker, 101).status, "observing");
  assert.equal(update(tracker, 201).status, "observing", "two frames need real elapsed time");
});

test("a persistent lower central object creates image-space caution without a safe-path claim", () => {
  const answer = stable(new HazardTracker());
  assert.equal(answer.status, "caution");
  assert.equal(answer.navigation_safe, false);
  assert.equal(answer.hazards[0].direction, "center");
  assert.deepEqual(answer.hazards[0].reasons, ["stable_presence", "central_lower"]);
  assert.match(answer.summary, /화면 중앙/);
  assert.doesNotMatch(answer.summary, /안전합니다|이동하세요|피하세요|충돌까지|미터|접근 중/);
});

test("a large central vehicle requires two strong observations before priority", () => {
  const tracker = new HazardTracker(), vehicle = [detection("truck", box(0.5, 0.65, 0.5, 0.5), 0.9)];
  assert.equal(update(tracker, 0, vehicle).status, "observing");
  const answer = update(tracker, 200, vehicle);
  assert.equal(answer.status, "priority");
  assert.ok(answer.hazards[0].reasons.includes("strong_vehicle_evidence"));
  assert.match(answer.summary, /크게 보이는/);
  assert.equal(stable(new HazardTracker(), [detection("truck", vehicle[0].box, 0.78)]).status, "caution");
});

test("low confidence, small distant and unsupported semantic classes do not become warnings", () => {
  for (const detections of [
    [detection("car", box(), 0.61)], [detection("car", box(), 0.69)],
    [detection("car", box(0.5, 0.2, 0.1))], [detection("traffic light", box())],
  ]) assert.equal(stable(new HazardTracker(), detections).status, "observing");
  const tracker = new HazardTracker();
  update(tracker, 0, [detection("car", box(), 0.66)]);
  assert.equal(update(tracker, 200, [detection("car", box(), 0.76)]).status, "observing");
});

test("malformed scores, classes and boxes are rejected without mutating input", () => {
  const invalid = [
    detection("car", box(), NaN), detection("car", box(), 1.01),
    detection("car", { left: 0.5, right: 0.5, top: 0.2, bottom: 0.8 }),
    detection("car", { left: -0.1, right: 0.5, top: 0.2, bottom: 0.8 }),
    detection("car", { left: 0.1, right: NaN, top: 0.2, bottom: 0.8 }),
    { ...detection(), classId: 1.2 }, null,
  ];
  assert.equal(stable(new HazardTracker(), invalid).hazards.length, 0);
  const frozen = Object.freeze({ ...detection(), box: Object.freeze(box()) });
  assert.equal(stable(new HazardTracker(), Object.freeze([frozen])).status, "caution");
});

test("duplicate and nested detections in one frame cannot inflate track evidence", () => {
  const tracker = new HazardTracker();
  const duplicates = [detection(), detection("car", box(0.501, 0.701, 0.3), 0.88), detection("car", box(0.5, 0.7, 0.27), 0.87)];
  assert.equal(update(tracker, 0, duplicates).hazards.length, 0);
  assert.equal(tracker.getDiagnostics().trackCount, 1);
  const answer = update(tracker, 200, duplicates);
  assert.equal(answer.hazards.length, 1);
  assert.equal(tracker.getDiagnostics().sampleCount, 2);
});

test("empty current frame removes old warnings immediately and a lost track needs confirmation again", () => {
  const tracker = new HazardTracker(), first = stable(tracker), id = first.hazards[0].trackId;
  assert.equal(update(tracker, 400, []).status, "observing");
  assert.equal(update(tracker, 600).status, "observing");
  assert.equal(update(tracker, 800).hazards[0].trackId, id, "short loss can retain identity, not its evidence");
});

test("a sample gap over one second discards old track evidence", () => {
  const tracker = new HazardTracker();
  const before = stable(tracker).hazards[0].trackId;
  assert.equal(update(tracker, 1201).status, "observing");
  assert.notEqual(update(tracker, 1401).hazards[0].trackId, before);
});

test("stale, poor-quality, failed, future and invalid results clear temporal evidence", () => {
  const cases = [
    [result(200), 1201],
    [result(400, [], { status: "retake", reason: "too_dark" }), 400],
    [{ ...result(400), error: "inference failed" }, 400],
    [result(500), 400], [null, 400], [{ ...result(400), detections: null }, 400],
  ];
  for (const [bad, now] of cases) {
    const tracker = new HazardTracker(); stable(tracker);
    const answer = tracker.update(bad, now);
    assert.equal(answer.status, "unavailable");
    assert.equal(answer.navigation_safe, false);
    assert.equal(tracker.getDiagnostics().trackCount, 0);
    assert.equal(update(tracker, now + 1).status, "observing");
  }
});

test("staleness boundary is inclusive at one second and frame order never advances evidence", () => {
  const tracker = new HazardTracker();
  const latest = stable(tracker);
  assert.deepEqual(tracker.update(result(100), 300), latest);
  assert.equal(tracker.getDiagnostics().sampleCount, 2);
  assert.deepEqual(tracker.update(result(200), 1200), latest);
  assert.equal(tracker.update(result(200), 1201).status, "unavailable");
});

test("class-aware matching does not inherit another object's history", () => {
  const tracker = new HazardTracker(); stable(tracker);
  assert.equal(update(tracker, 400, [detection("person")]).status, "observing");
  assert.equal(update(tracker, 600, [detection("person")]).hazards[0].label, "person");
  const withClass = new HazardTracker();
  update(withClass, 0, [{ ...detection(), classId: 2 }]);
  assert.equal(update(withClass, 200, [{ ...detection(), classId: 3 }]).status, "observing");
});

test("two same-class objects retain distinct one-to-one tracks before an ambiguous crossing", () => {
  const tracker = new HazardTracker();
  const pair = (a, b) => [detection("car", box(a, 0.72, 0.3)), detection("car", box(b, 0.72, 0.3), 0.89)];
  update(tracker, 0, pair(0.3, 0.7));
  const before = update(tracker, 200, pair(0.35, 0.65));
  assert.equal(new Set(before.hazards.map(h => h.trackId)).size, 2);
  const crossed = update(tracker, 400, pair(0.45, 0.55));
  assert.equal(new Set(crossed.hazards.map(h => h.trackId)).size, crossed.hazards.length);
  assert.ok(crossed.hazards.every(h => !h.reasons.includes("apparent_growth")));
  const merged = update(tracker, 600, [detection("car", box(0.5, 0.72, 0.35))]);
  assert.ok(merged.hazards.length <= 1);
  assert.ok(merged.hazards.every(h => !h.reasons.includes("apparent_growth")));
});

test("well-associated monotonic growth takes at least three samples spanning 400 milliseconds", () => {
  const tracker = new HazardTracker();
  update(tracker, 0, [detection("car", box(0.5, 0.7, 0.26))]);
  const second = update(tracker, 200, [detection("car", box(0.5, 0.7, 0.31))]);
  assert.ok(second.hazards.every(h => !h.reasons.includes("apparent_growth")));
  const third = update(tracker, 400, [detection("car", box(0.5, 0.7, 0.37))]);
  assert.equal(third.status, "priority");
  assert.ok(third.hazards[0].reasons.includes("apparent_growth"));
  assert.match(third.summary, /영상 크기가 커지고/);
  assert.match(third.summary, /실제 거리는 알 수 없습니다/);
  assert.doesNotMatch(third.summary, /다가오|접근|충돌|초 후|미터/);
  const tooFast = new HazardTracker();
  for (const [i, w] of [0.26, 0.31, 0.37].entries()) {
    const a = update(tooFast, i * 100, [detection("car", box(0.5, 0.7, w))]);
    assert.ok(a.hazards.every(h => !h.reasons.includes("apparent_growth")));
  }
});

test("cropping, aspect changes, abrupt jumps and non-monotonic jitter suppress growth", () => {
  const cropped = growing(new HazardTracker(), { x: 0.2 });
  assert.ok(cropped.hazards.every(h => !h.reasons.includes("apparent_growth")));
  for (const sequence of [
    [box(0.5, 0.7, 0.26), box(0.5, 0.7, 0.4), box(0.5, 0.7, 0.44)],
    [box(0.5, 0.7, 0.26), box(0.5, 0.7, 0.37), box(0.5, 0.7, 0.36)],
    [box(0.5, 0.7, 0.26), box(0.5, 0.7, 0.34, 0.29), box(0.5, 0.7, 0.43, 0.30)],
  ]) {
    const tracker = new HazardTracker(); let answer;
    for (const [i, b] of sequence.entries()) answer = update(tracker, i * 200, [detection("car", b)]);
    assert.ok(answer.hazards.every(h => !h.reasons.includes("apparent_growth")));
  }
});

test("common scene enlargement suppresses apparent growth evidence across different classes", () => {
  const tracker = new HazardTracker(); let answer;
  for (const [i, w] of [0.18, 0.225, 0.28].entries()) {
    answer = update(tracker, i * 200, [
      detection("person", box(0.25, 0.65, w)), detection("car", box(0.5, 0.65, w)), detection("bench", box(0.75, 0.65, w)),
    ]);
  }
  assert.ok(answer.hazards.length > 0);
  assert.ok(answer.hazards.every(h => !h.reasons.includes("apparent_growth")));
});

test("moving peripheral vehicles get an image-motion cue while scene-wide pan suppresses it", () => {
  const tracker = new HazardTracker(); let answer;
  for (const [i, x] of [0.18, 0.235, 0.29].entries()) {
    answer = update(tracker, i * 200, [detection("car", box(x, 0.68, 0.26))]);
  }
  assert.equal(answer.status, "caution");
  assert.equal(answer.hazards[0].direction, "left");
  assert.ok(answer.hazards[0].reasons.includes("peripheral_motion"));
  const panning = new HazardTracker();
  for (const [i, offset] of [0, 0.055, 0.11].entries()) {
    answer = update(panning, i * 200, [
      detection("car", box(0.18 + offset, 0.68, 0.26)),
      detection("person", box(0.48 + offset, 0.68, 0.26)),
      detection("bench", box(0.72 + offset, 0.68, 0.26)),
    ]);
  }
  assert.ok(answer.hazards.every(h => !h.reasons.includes("peripheral_motion")));
});

test("small direction-boundary jitter does not flip screen-relative directions", () => {
  const tracker = new HazardTracker();
  update(tracker, 0, [detection("car", box(0.34, 0.72, 0.32))]);
  assert.equal(update(tracker, 200, [detection("car", box(0.36, 0.72, 0.32))]).hazards[0].direction, "left");
  assert.equal(update(tracker, 400, [detection("car", box(0.40, 0.72, 0.32))]).hazards[0].direction, "center");
});

test("output ranking favors priority evidence rather than the raw highest confidence", () => {
  const answer = stable(new HazardTracker(), [
    detection("truck", box(0.5, 0.65, 0.5), 0.86),
    detection("person", box(0.3, 0.75, 0.32), 0.99),
  ]);
  assert.equal(answer.hazards[0].label, "truck");
  assert.equal(answer.hazards[0].level, "priority");
});

test("returned assessment mutation cannot corrupt replayed tracker state", () => {
  const tracker = new HazardTracker(), answer = stable(tracker);
  answer.hazards[0].reasons.push("invented"); answer.hazards[0].level = "priority";
  const replay = tracker.update(result(200), 300);
  assert.equal(replay.hazards[0].level, "caution");
  assert.ok(!replay.hazards[0].reasons.includes("invented"));
});

test("tracker caps inputs, histories, tracks and hazards across ten thousand frames", () => {
  const tracker = new HazardTracker();
  const labels = ["person", "bicycle", "car", "motorcycle", "bus", "truck", "train", "dog", "cat", "bench", "chair", "suitcase", "backpack", "umbrella", "potted plant", "fire hydrant"];
  const detections = labels.map((label, i) => detection(label, box(0.25 + (i % 3) * 0.25, 0.65, 0.25), 0.9));
  for (let i = 0; i < 10000; i++) {
    const answer = update(tracker, i * 200, detections);
    const diagnostics = tracker.getDiagnostics();
    assert.ok(diagnostics.trackCount <= HAZARD_LIMITS.maxTracks);
    assert.ok(diagnostics.sampleCount <= HAZARD_LIMITS.maxTracks * HAZARD_LIMITS.maxHistory);
    assert.ok(diagnostics.maxHistory <= HAZARD_LIMITS.maxHistory);
    assert.ok(answer.hazards.length <= HAZARD_LIMITS.maxHazards);
  }
  const boundedInput = new HazardTracker();
  const input = Array(25).fill(detection("car", box(), 0.1));
  Object.defineProperty(input, 25, { get() { throw new Error("read beyond detector contract"); } });
  assert.equal(stable(boundedInput, input).status, "observing");
  tracker.reset();
  assert.deepEqual(tracker.getDiagnostics(), { trackCount: 0, sampleCount: 0, maxHistory: 0 });
});

test("priority escalation bypasses ordinary speech cooldown and repeated frames do not repeat speech", () => {
  const gate = new HazardAnnouncementGate();
  assert.match(gate.offer(assessment(200), 200), /^주의/);
  assert.equal(gate.offer(assessment(200), 250), null);
  assert.match(gate.offer(assessment(400, "priority"), 400), /^우선 주의/);
  assert.equal(gate.offer(assessment(600, "priority"), 600), null);
  assert.equal(gate.offer(assessment(8000, "priority"), 8000), null);
  assert.match(gate.offer(assessment(8400, "priority"), 8400), /^우선 주의/);
});

test("ordinary announcements use global cooldown with no queued messages", () => {
  const gate = new HazardAnnouncementGate();
  assert.ok(gate.offer(assessment(0), 0));
  assert.equal(gate.offer(assessment(200, "caution", 2, "left"), 200), null);
  assert.equal(gate.offer(assessment(4200, "observing"), 4200), null, "suppressed object is not queued");
  assert.ok(gate.offer(assessment(4400, "caution", 3, "right"), 4400));
});

test("disappearance re-arms an object after cooldown but not a one-frame flicker", () => {
  const gate = new HazardAnnouncementGate();
  assert.ok(gate.offer(assessment(0), 0));
  gate.offer(assessment(200, "observing"), 200);
  assert.equal(gate.offer(assessment(400), 400), null);
  gate.offer(assessment(600, "observing"), 600);
  assert.ok(gate.offer(assessment(4200), 4200), "reappearance after disappearance and cooldown");
});

test("gate rejects stale, unavailable and regressing assessments and bounds its own history", () => {
  const gate = new HazardAnnouncementGate();
  assert.equal(gate.offer(assessment(0), 1001), null);
  for (let i = 0; i < 10000; i++) {
    gate.offer(assessment(i * 200, i % 3 ? "caution" : "priority", i + 1), i * 200);
    assert.ok(gate.getDiagnostics().entryCount <= 6);
  }
  assert.equal(gate.offer({ ...assessment(2000000), status: "unavailable" }, 2000000), null);
  assert.equal(gate.getDiagnostics().entryCount, 0);
  gate.offer(assessment(2000001), 2000001);
  assert.equal(gate.offer(assessment(100), 100), null);
  assert.equal(gate.getDiagnostics().entryCount, 0);
});

test("automatic warnings say screen direction and object first, with a short image-only cue", () => {
  const tracker = new HazardTracker(), value = growing(tracker);
  const speech = new HazardAnnouncementGate().offer(value, value.observedAt);
  assert.match(speech, /^우선 주의\. 화면 중앙 자동차\./);
  assert.ok(speech.length < 55);
  assert.match(speech, /화면에서 커져/);
  assert.doesNotMatch(speech, /미터|충돌까지|안전|다가오/);
  assert.match(value.summary, /실제 거리는 알 수 없습니다/);
});

test('unplayed reservations do not apply cooldown and can be retried on the next frame', () => {
 const gate=new HazardAnnouncementGate();
 const reserved=gate.reserve(assessment(0),0); assert.ok(reserved);
 reserved.onDropped();
 assert.ok(gate.reserve(assessment(200),200));
});
test('delivered reservations apply cooldown, while escalation bypasses it', () => {
 const gate=new HazardAnnouncementGate();
 const reserved=gate.reserve(assessment(0),0); assert.ok(reserved);
 gate.markDelivered(gate.pending,0);
 assert.equal(gate.reserve(assessment(200),200),null);
 assert.ok(gate.reserve(assessment(400,'priority'),400));
});
test('late delivery of a cancelled warning cannot commit a newer reservation', () => {
 const gate=new HazardAnnouncementGate();
 const old=gate.reserve(assessment(0),0); old.onDropped();
 const next=gate.reserve(assessment(200,'priority'),200); assert.ok(next);
 old.onDelivered(); assert.ok(gate.pending);
 next.onDropped(); assert.equal(gate.pending,null);
});
