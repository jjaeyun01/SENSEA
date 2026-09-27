import assert from "node:assert/strict";
import test from "node:test";
import { projectBoxToPreview } from "../preview-geometry.mjs";
const image = { width: 480, height: 640 }, view = { width: 300, height: 300 };
test("portrait content uses cover cropping instead of stretching the detection box", () => {
  assert.deepEqual(projectBoxToPreview({ left: 0.25, right: 0.75, top: 0.25, bottom: 0.75 }, image, view),
    { left: 75, top: 50, width: 150, height: 200 });
});
test("landscape input clips horizontal crop correctly", () => {
  assert.deepEqual(projectBoxToPreview({ left: 0.25, right: 0.75, top: 0.25, bottom: 0.75 }, { width: 640, height: 480 }, view),
    { left: 50, top: 75, width: 200, height: 150 });
});
test("fully cropped and subpixel boxes disappear; partial boxes remain inside preview", () => {
  assert.equal(projectBoxToPreview({ left: 0.2, right: 0.8, top: 0, bottom: 0.1 }, image, view), null);
  assert.deepEqual(projectBoxToPreview({ left: 0.25, right: 0.75, top: 0, bottom: 0.5 }, image, view), { left: 75, top: 0, width: 150, height: 150 });
  assert.equal(projectBoxToPreview({ left: 0.49, right: 0.491, top: 0.3, bottom: 0.7 }, image, view), null);
});
test("invalid geometry cannot produce a misleading overlay", () => {
  const b = { left: 0.2, right: 0.7, top: 0.2, bottom: 0.8 };
  for (const i of [null, {}, { width: 0, height: 20 }, { width: NaN, height: 20 }]) assert.equal(projectBoxToPreview(b, i, view), null);
  for (const invalid of [null, { ...b, left: -0.1 }, { ...b, top: NaN }, { ...b, bottom: 0.1 }]) assert.equal(projectBoxToPreview(invalid, image, view), null);
});
