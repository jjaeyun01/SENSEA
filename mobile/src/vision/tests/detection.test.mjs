import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeDetections, mapDetectionsToImageContent, assessRgbQuality, analyzeOwnedFrame, AnnouncementGate, describeResult,
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

test("the default decoder API returns five best detections", () => {
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


for (const orientation of ["left", "right"]) {
  test(`quality samples rotated ${orientation} content and excludes vertical letterbox bars`, () => {
    const r = leasedResources();
    Object.assign(r.frame, { width: 320, height: 80, orientation });
    const pixels = new Uint8Array(320 * 320 * 3);
    for (let y = 0; y < 320; y++) pixels.fill(255, (y * 320 + 120) * 3, (y * 320 + 200) * 3);
    r.converter.resize = () => ({
      getPixelBuffer: () => pixels.buffer,
      dispose() { r.events.push("gpu-free"); },
    });
    r.detector.runSync = () => { throw new Error("Overexposed content should not reach inference"); };
    const result = analyzeOwnedFrame(r.frame, r.converter, r.detector, labels, true);
    assert.equal(result.quality.reason, "too_bright");
    assert.deepEqual(result.detections, []);
    assert.deepEqual(r.events, ["gpu-free", "frame-free"]);
  });
}

for (const failInference of [false, true]) {
  test(`Android CPU path reuses input and returns the frame after inference (failure=${failInference})`, () => {
    const rgba = new Uint8Array(320 * 320 * 4);
    for (let i = 0; i < 320 * 320; i++) {
      const v = i % 320 % 16 < 8 ? 80 : 180;
      rgba.set([v, v, v, 255], i * 4);
    }
    const target = new Uint8Array(320 * 320 * 3);
    const events = [];
    const frame = {
      width: 320, height: 320, bytesPerRow: 1280, pixelFormat: "rgb-rgba-8-bit",
      isPlanar: false, orientation: "up", isMirrored: false,
      getPixelBuffer() { throw new Error("Do not lock the HardwareBuffer"); },
      getPlanes() { return [{ bytesPerRow: 1280, getPixelBuffer() { events.push("read"); return rgba.buffer; } }]; },
      dispose() { events.push("frame-free"); },
    };
    const detector = { runSync([input]) {
      assert.equal(input, target.buffer);
      assert.deepEqual(events, ["read"]);
      events.push("infer");
      if (failInference) throw new Error("CPU inference failed");
      return outputs();
    } };
    const run = () => analyzeOwnedFrame(frame, undefined, detector, labels, true, target);
    if (failInference) assert.throws(run, /CPU inference failed/);
    else assert.equal(run().detections[0].label, "person");
    assert.deepEqual(events, ["read", "infer", "frame-free"]);
  });
}

function detectionBox(top, left, bottom, right) {
  return { classId: 2, label: "car", score: 0.8, box: { top, left, bottom, right } };
}
function assertBoxClose(actual, expected) {
  for (const key of ["top", "left", "bottom", "right"]) {
    assert.ok(Math.abs(actual[key] - expected[key]) < 0.000001,
      `${key}: expected ${expected[key]}, got ${actual[key]}`);
  }
}

test("hazard decoding can retain all 25 candidates and rejects an unbounded limit", () => {
  const modelOutputs = outputs(Array(25).fill(0), Array(25).fill(0.9), Array(25).fill([0, 0, 1, 1]).flat());
  assert.equal(decodeDetections(modelOutputs, labels, 0.55, 25).length, 25);
  assert.equal(decodeDetections(modelOutputs, labels, 0.55, 1).length, 1);
  for (const limit of [0, -1, 26, 1.5, NaN, Infinity, "25"]) {
    assert.throws(() => decodeDetections(modelOutputs, labels, 0.55, limit), /result limit/);
  }
});

for (const [name, width, height, modelBox, contentBox] of [
  ["landscape", 640, 480, [0.25, 0.25, 0.75, 0.75], { top: 1 / 6, left: 0.25, bottom: 5 / 6, right: 0.75 }],
  ["portrait", 480, 640, [0.25, 0.25, 0.75, 0.75], { top: 0.25, left: 1 / 6, bottom: 0.75, right: 5 / 6 }],
  ["square", 320, 320, [0.25, 0.25, 0.75, 0.75], { top: 0.25, left: 0.25, bottom: 0.75, right: 0.75 }],
  ["odd landscape padding", 641, 480, [40 / 320, 0, 279 / 320, 1], { top: 0, left: 0, bottom: 1, right: 1 }],
  ["odd portrait padding", 480, 641, [0, 40 / 320, 1, 279 / 320], { top: 0, left: 0, bottom: 1, right: 1 }],
]) {
  test(`model boxes map to upright image content using exact ${name} contain geometry`, () => {
    const original = detectionBox(...modelBox);
    const snapshot = structuredClone(original);
    const [mapped] = mapDetectionsToImageContent([original], width, height);
    assertBoxClose(mapped.box, contentBox);
    assert.equal(mapped.classId, original.classId);
    assert.equal(mapped.label, original.label);
    assert.equal(mapped.score, original.score);
    assert.deepEqual(original, snapshot, "Mapping must not mutate detector metadata");
  });
}

test("boxes crossing padding are clipped to visible content", () => {
  const mapped = mapDetectionsToImageContent([
    detectionBox(0, 0.1, 1, 0.9), detectionBox(-1, -1, 2, 2),
  ], 640, 480);
  assertBoxClose(mapped[0].box, { top: 0, left: 0.1, bottom: 1, right: 0.9 });
  assertBoxClose(mapped[1].box, { top: 0, left: 0, bottom: 1, right: 1 });
});

test("boxes wholly in padding, exactly touching its edge, or having invalid geometry are discarded", () => {
  const padding = [detectionBox(0, 0, 0.1, 1), detectionBox(0, 0, 0.125, 1),
    detectionBox(0.875, 0, 1, 1), detectionBox(0.9, 0, 1, 1)];
  const invalid = [detectionBox(0.5, 0, 0.5, 1), detectionBox(0, 0.5, 1, 0.5),
    detectionBox(0.8, 0, 0.2, 1), detectionBox(0, 0.8, 1, 0.2),
    detectionBox(NaN, 0, 1, 1), detectionBox(0, Infinity, 1, 1),
    detectionBox(0, 0, "1", 1), { label: "car" }, null];
  assert.deepEqual(mapDetectionsToImageContent([...padding, ...invalid], 640, 480), []);
  assert.deepEqual(mapDetectionsToImageContent([
    detectionBox(0, 0, 1, 0.125), detectionBox(0, 0.875, 1, 1),
  ], 480, 640), []);
});

test("invalid source geometry fails explicitly and mapping never exceeds 25 metadata items", () => {
  for (const invalid of [0, -1, 1.5, NaN, Infinity, "320"]) {
    assert.throws(() => mapDetectionsToImageContent([], invalid, 320), /image geometry/);
    assert.throws(() => mapDetectionsToImageContent([], 320, invalid), /image geometry/);
  }
  assert.equal(mapDetectionsToImageContent(Array(100).fill(detectionBox(0, 0, 1, 1)), 320, 320).length, 25);
});

for (const orientation of ["left", "right"]) {
  test(`owned-frame ${orientation} sensor orientation maps already-upright model boxes once`, () => {
    const r = leasedResources();
    Object.assign(r.frame, { width: 640, height: 480, orientation, isMirrored: true });
    r.detector.runSync = () => { r.events.push("infer"); return outputs([2], [0.9], [0.25, 0.25, 0.75, 0.75]); };
    const result = analyzeOwnedFrame(r.frame, r.converter, r.detector, labels, true);
    assertBoxClose(result.detections[0].box, { top: 0.25, left: 1 / 6, bottom: 0.75, right: 5 / 6 });
    assert.deepEqual(r.events, ["resize", "infer", "gpu-free", "frame-free"]);
  });
}

test("owned-frame hazard pipeline retains lower-confidence objects after removing padding detections", () => {
  const r = leasedResources();
  const classes = Array(25).fill(0); classes[24] = 2;
  const boxes = Array.from({ length: 25 }, (_, i) => i === 0 ? [0, 0, 0.1, 1] : [0.5, 0.4, 0.875, 0.6]).flat();
  r.detector.runSync = () => {
    r.events.push("infer");
    return outputs(classes, Array.from({ length: 25 }, (_, i) => 0.99 - i * 0.01), boxes);
  };
  const result = analyzeOwnedFrame(r.frame, r.converter, r.detector, labels, true);
  assert.equal(result.detections.length, 24);
  assert.equal(result.detections.at(-1).label, "car");
  assertBoxClose(result.detections.at(-1).box, { top: 0.5, left: 0.4, bottom: 1, right: 0.6 });
  assert.deepEqual(r.events, ["resize", "infer", "gpu-free", "frame-free"]);
});

test("invalid camera dimensions release the frame before allocating a converted image", () => {
  for (const width of [0, -1, 1.5, NaN, Infinity]) {
    const r = leasedResources();
    r.frame.width = width;
    assert.throws(() => analyzeOwnedFrame(r.frame, r.converter, r.detector, labels, true), /camera dimensions/);
    assert.deepEqual(r.events, ["frame-free"]);
  }
});
