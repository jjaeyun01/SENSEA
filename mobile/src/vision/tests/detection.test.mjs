import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeDetections, assessRgbQuality, analyzeOwnedFrame, AnnouncementGate, describeResult,
} from "../detection.mjs";

const labels = ["person", "bicycle", "car", "???"];
const outputs = (classes = [0], scores = [0.9], boxes = [0.1, 0.2, 0.8, 0.9]) =>
  [boxes, classes, scores, [classes.length]].map(array => Float32Array.from(array).buffer);

function rgbPattern() {
  const data = new Uint8Array(320 * 320 * 3);
  for (let y = 0; y < 320; y++) {
    for (let x = 0; x < 320; x++) {
      const v = x % 16 < 8 ? 80 : 180;
      data.fill(v, (y * 320 + x) * 3, (y * 320 + x + 1) * 3);
    }
  }
  return data.buffer;
}
const result = (labels = ["person"]) => ({
  quality: { status: "usable", reason: null },
  detections: labels.map(label => ({ label })),
});

test("the four pinned model outputs map to class, score and normalized box", () => {
  const [detection] = decodeDetections(outputs([2]), labels);
  assert.equal(detection.label, "car");
  assert.equal(detection.classId, 2);
  assert.ok(Math.abs(detection.box.left - 0.2) < 0.00001);
});

test("unknown labels, low scores, invalid classes and NaNs are rejected", () => {
  const classes = [0, 3, 100, 0.2, 2];
  const scores = [0.1, 0.99, 0.99, 0.9, NaN];
  assert.deepEqual(decodeDetections(outputs(classes, scores, Array(5).fill([0, 0, 1, 1]).flat()), labels), []);
});

test("a changed model shape fails instead of mislabeling results", () => {
  assert.throws(() => decodeDetections(outputs().slice(0, 2), labels));
  assert.throws(() => decodeDetections([
    new ArrayBuffer(400000), new ArrayBuffer(100), new ArrayBuffer(100), new ArrayBuffer(4),
  ], labels));
  const invalid = outputs();
  invalid[3] = Float32Array.from([26]).buffer;
  assert.throws(() => decodeDetections(invalid, labels));
});

test("only five best detections cross to the UI", () => {
  const detections = decodeDetections(
    outputs(Array(25).fill(0), Array(25).fill(0.9), Array(25).fill([0, 0, 1, 1]).flat()), labels,
  );
  assert.equal(detections.length, 5);
});

test("local RGB checks distinguish severe exposure problems and usable texture", () => {
  for (const [value, reason] of [[0, "too_dark"], [255, "too_bright"], [128, "low_detail"]]) {
    assert.equal(assessRgbQuality(new Uint8Array(320 * 320 * 3).fill(value).buffer, 320, 320).reason, reason);
  }
  assert.equal(assessRgbQuality(rgbPattern(), 320, 320).status, "usable");
});

test("letterbox padding is excluded from brightness checks", () => {
  const data = new Uint8Array(320 * 320 * 3);
  // A bright 80x320 portrait content region with large dark padding.
  for (let y = 0; y < 320; y++) data.fill(255, (y * 320 + 120) * 3, (y * 320 + 200) * 3);
  assert.equal(assessRgbQuality(data.buffer, 80, 320).reason, "too_bright");
});

function leasedResources({ failResize = false, failInference = false, failGpuDispose = false } = {}) {
  const events = [];
  let live = true;
  const pixels = rgbPattern();
  return {
    events,
    frame: { width: 640, height: 480, dispose() { events.push("frame-free"); } },
    converter: {
      resize() {
        events.push("resize");
        if (failResize) throw new Error("resize failed");
        return {
          getPixelBuffer() { assert.equal(live, true); return pixels; },
          dispose() {
            events.push("gpu-free");
            live = false;
            if (failGpuDispose) throw new Error("gpu cleanup failed");
          },
        };
      },
    },
    detector: {
      runSync([buffer]) {
        assert.equal(live, true, "GPU buffer must remain valid throughout inference");
        assert.equal(buffer, pixels, "Do not copy full frame data to RN");
        events.push("infer");
        if (failInference) throw new Error("inference failed");
        return outputs();
      },
    },
  };
}

test("successful inference keeps GPU memory alive until inference ends, then releases both leases", () => {
  const r = leasedResources();
  const detection = analyzeOwnedFrame(r.frame, r.converter, r.detector, labels, true);
  assert.equal(detection.detections[0].label, "person");
  assert.deepEqual(r.events, ["resize", "infer", "gpu-free", "frame-free"]);
});

test("10,000 skipped native frames release immediately without any pixel allocation", () => {
  const r = leasedResources();
  for (let i = 0; i < 10000; i++) {
    assert.equal(analyzeOwnedFrame(r.frame, r.converter, r.detector, labels, false), null);
  }
  assert.equal(r.events.length, 10000);
  assert.ok(r.events.every(event => event === "frame-free"));
});

for (const options of [{ failResize: true }, { failInference: true }, { failGpuDispose: true }]) {
  test("native errors still release the original frame: " + JSON.stringify(options), () => {
    const r = leasedResources(options);
    assert.throws(() => analyzeOwnedFrame(r.frame, r.converter, r.detector, labels, true));
    assert.equal(r.events.filter(event => event === "frame-free").length, 1);
    assert.equal(r.events.at(-1), "frame-free");
  });
}

test("unexpected large camera buffers are rejected before conversion", () => {
  const r = leasedResources();
  r.frame.width = 4000;
  r.frame.height = 3000;
  assert.throws(() => analyzeOwnedFrame(r.frame, r.converter, r.detector, labels, true));
  assert.deepEqual(r.events, ["frame-free"]);
});

test("announcements require stability and a cooldown, without repeating unchanged observations", () => {
  const gate = new AnnouncementGate();
  assert.equal(gate.offer(result(), 0), null);
  assert.match(gate.offer(result(), 200), /사람/);
  assert.equal(gate.offer(result(), 5000), null);
  assert.equal(gate.offer(result(["car"]), 5200), null);
  assert.match(gate.offer(result(["car"]), 5400), /자동차/);
  assert.equal(gate.offer(result(["bicycle"]), 5600), null);
  assert.equal(gate.offer(result(["bicycle"]), 5800), null);
  assert.match(gate.offer(result(["bicycle"]), 10000), /자전거/);
});

test("no detection never becomes permission to move", () => {
  const gate = new AnnouncementGate();
  assert.equal(gate.offer(result([]), 0), null);
  assert.equal(gate.offer(result([]), 5000), null);
  assert.match(describeResult(result([])), /식별하지 못/);
});

test("retake guidance is spoken only after a stable quality problem", () => {
  const gate = new AnnouncementGate();
  const dark = { quality: { status: "retake", reason: "too_dark" }, detections: [] };
  assert.equal(gate.offer(dark, 0), null);
  assert.match(gate.offer(dark, 200), /어둡/);
  gate.reset();
  assert.equal(gate.offer(dark, 500), null);
});


test("results with missing, future or expired timestamps are never fresh", async () => {
  const { isFreshResult } = await import("../detection.mjs");
  assert.equal(isFreshResult({ receivedAt: 100 }, 1100), true);
  for (const receivedAt of [undefined, NaN, Infinity, 1101, 99]) {
    assert.equal(isFreshResult({ receivedAt }, 1100), false);
  }
  assert.equal(isFreshResult(null, 1100), false);
});
