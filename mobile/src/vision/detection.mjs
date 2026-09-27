import { resizeCpuRgbFrame } from "./cpu-rgb.mjs";
import { isAutomaticSpeechTarget } from "./automatic-speech.mjs";
import { selectNearFieldDetections } from "./near-field.mjs";

/** Fixed contract for the SHA-256-pinned TensorFlow model with built-in NMS. */
export function decodeDetections(outputs, labels, threshold = 0.55, maxDetections = 5) {
  "worklet";
  if (!Number.isInteger(maxDetections) || maxDetections < 1 || maxDetections > 25) {
    throw new Error("Invalid detector result limit");
  }
  if (outputs.length !== 4) throw new Error("Unexpected detector output count");
  const [boxBuffer, classBuffer, scoreBuffer, countBuffer] = outputs;
  if (outputs.some(buffer => buffer.byteLength % 4 !== 0) ||
      countBuffer.byteLength !== 4 || boxBuffer.byteLength > 25 * 4 * 4 ||
      classBuffer.byteLength > 25 * 4 || scoreBuffer.byteLength > 25 * 4) {
    throw new Error("Unexpected detector output size");
  }
  const boxes = new Float32Array(boxBuffer);
  const classes = new Float32Array(classBuffer);
  const scores = new Float32Array(scoreBuffer);
  const count = new Float32Array(countBuffer)[0];
  if (!Number.isInteger(count) || count < 0 || count > 25 ||
      boxes.length < count * 4 || classes.length < count || scores.length < count) {
    throw new Error("Invalid detection count");
  }
  const result = [];
  for (let i = 0; i < count; i++) {
    const classId = classes[i], score = scores[i];
    const label = labels[classId];
    if (!Number.isInteger(classId) || !label || label === "???" ||
        !Number.isFinite(score) || score < threshold || score > 1) continue;
    const raw = [boxes[i * 4], boxes[i * 4 + 1], boxes[i * 4 + 2], boxes[i * 4 + 3]];
    if (!raw.every(Number.isFinite)) continue;
    const [top, left, bottom, right] = raw.map(n => Math.max(0, Math.min(1, n)));
    if (bottom <= top || right <= left) continue;
    result.push({ classId, label, score, box: { top, left, bottom, right } });
  }
  return result.sort((a, b) => b.score - a.score).slice(0, maxDetections);
}

/** Remove the model's contain padding. Width/height describe already-upright
 * image content, matching the resizer; sensor rotation/mirroring is not repeated.
 * Only bounded detection metadata is allocated, never another image buffer.
 */
export function mapDetectionsToImageContent(detections, sourceWidth, sourceHeight) {
  "worklet";
  if (!Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight) ||
      sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("Invalid detection image geometry");
  }
  const size = 320;
  const scale = Math.min(size / sourceWidth, size / sourceHeight);
  const width = Math.max(1, Math.floor(sourceWidth * scale));
  const height = Math.max(1, Math.floor(sourceHeight * scale));
  const left = Math.floor((size - width) / 2), top = Math.floor((size - height) / 2);
  const result = [];
  for (let i = 0; i < Math.min(detections.length, 25); i++) {
    const detection = detections[i], box = detection?.box;
    if (!box || !Number.isFinite(box.top) || !Number.isFinite(box.left) ||
        !Number.isFinite(box.bottom) || !Number.isFinite(box.right) ||
        box.bottom <= box.top || box.right <= box.left) continue;
    const mappedTop = Math.max(0, Math.min(1, (box.top * size - top) / height));
    const mappedLeft = Math.max(0, Math.min(1, (box.left * size - left) / width));
    const mappedBottom = Math.max(0, Math.min(1, (box.bottom * size - top) / height));
    const mappedRight = Math.max(0, Math.min(1, (box.right * size - left) / width));
    if (mappedBottom <= mappedTop || mappedRight <= mappedLeft) continue;
    result.push({ classId: detection.classId, label: detection.label, score: detection.score,
      box: { top: mappedTop, left: mappedLeft, bottom: mappedBottom, right: mappedRight } });
  }
  return result;
}

/** Samples the image content, excluding the resizer's black letterbox bars. */
export function assessRgbQuality(buffer, sourceWidth, sourceHeight) {
  "worklet";
  if (buffer.byteLength !== 320 * 320 * 3 || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("Invalid RGB model input");
  }
  const rgb = new Uint8Array(buffer);
  const scale = Math.min(320 / sourceWidth, 320 / sourceHeight);
  const width = Math.max(1, Math.floor(sourceWidth * scale));
  const height = Math.max(1, Math.floor(sourceHeight * scale));
  const left = Math.floor((320 - width) / 2), top = Math.floor((320 - height) / 2);
  let samples = 0, dark = 0, bright = 0, edge = 0, pairs = 0;
  for (let y = top + 2; y < top + height - 2; y += 4) {
    let previous = -1;
    for (let x = left + 2; x < left + width - 2; x += 4) {
      const p = (y * 320 + x) * 3;
      const luma = (77 * rgb[p] + 150 * rgb[p + 1] + 29 * rgb[p + 2]) / 256;
      samples++;
      if (luma <= 24) dark++;
      if (luma >= 240) bright++;
      if (previous >= 0) { edge += Math.abs(luma - previous); pairs++; }
      previous = luma;
    }
  }
  let reason = null;
  if (samples === 0) reason = "low_resolution";
  else if (dark / samples >= 0.85) reason = "too_dark";
  else if (bright / samples >= 0.85) reason = "too_bright";
  else if (!pairs || edge / pairs < 1.5) reason = "low_detail";
  return { status: reason ? "retake" : "usable", reason };
}

const DISPLAY_LABELS = {
  person: "Person", bicycle: "Bicycle", car: "Car", motorcycle: "Motorcycle",
  bus: "Bus", truck: "Truck", train: "Train", "traffic light": "Traffic light",
  "stop sign": "STOP sign", bench: "Bench", chair: "Chair", dog: "Dog", cat: "Cat",
  backpack: "Backpack", umbrella: "Umbrella", suitcase: "Suitcase",
  "potted plant": "Potted plant", "fire hydrant": "Fire hydrant", "parking meter": "Parking meter",
  couch: "Couch", "dining table": "Dining table", bed: "Bed", handbag: "Handbag",
};
export function displayLabel(label) { return DISPLAY_LABELS[label] ?? label.replace(/_/g, " ").replace(/^./, first => first.toUpperCase()); }

export function describeResult(result) {
  const qualityMessages = {
    too_dark: "The image is too dark. Check the lighting and whether the lens is covered.",
    too_bright: "The image is too bright. Check for glare or strong light.",
    low_detail: "The image lacks detail. Check the focus and what the camera is pointing at.",
    low_resolution: "Check the camera image resolution.",
  };
  if (result.quality.reason) return qualityMessages[result.quality.reason] ?? "Check the camera view.";
  const labels = [...new Set(result.detections.map(item => displayLabel(item.label)))].slice(0, 3);
  return labels.length ? "Detected: " + labels.join(", ") + "." : "No objects identified. Objects may still be present.";
}

export function isFreshResult(result, now) {
  const age = now - result?.receivedAt;
  return Number.isFinite(age) && age >= 0 && age <= 1000;
}

/** Constant-space announcement debounce. Never infer a clear or safe path. */
export class AnnouncementGate {
  constructor() { this.reset(); }
  reset() { this.key = ""; this.hits = 0; this.spoken = ""; this.lastAt = -Infinity; }
  offer(result, now) {
    // Filter only the automatic speech view; keep the original result intact.
    result = { ...result, detections: result.detections.filter(item => isAutomaticSpeechTarget(item) && !item.nearCandidate) };
    const key = result.quality.reason ??
      [...new Set(result.detections.map(item => item.label))].sort().join("|");
    if (key !== this.key) { this.key = key; this.hits = 1; } else this.hits++;
    if (!key || this.hits < 2 || key === this.spoken || now - this.lastAt < 4000) return null;
    this.spoken = key;
    this.lastAt = now;
    return describeResult(result);
  }
}

/** The only owner of each incoming native frame, including skipped/error paths.
 * @param {Uint8Array | undefined} [cpuRgbBuffer] Reusable Android model input.
 */
export function analyzeOwnedFrame(frame, converter, detector, labels, shouldAnalyze, cpuRgbBuffer = undefined) {
  "worklet";
  let converted;
  try {
    if (!shouldAnalyze) return null;
    if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) ||
        frame.width <= 0 || frame.height <= 0) throw new Error("Invalid camera dimensions");
    if (frame.width * frame.height > 1280 * 720) throw new Error("Camera resolution exceeds budget");
    const preprocessingStarted = performance.now();
    let input;
    if (cpuRgbBuffer) input = resizeCpuRgbFrame(frame, cpuRgbBuffer);
    else {
      converted = converter.resize(frame);
      input = converted.getPixelBuffer();
    }
    // Resize has already applied sensor orientation; match its letterbox
    // dimensions so rotated portrait content is not mistaken for dark padding.
    const rotated = frame.orientation === "right" || frame.orientation === "left";
    const uprightWidth = rotated ? frame.height : frame.width;
    const uprightHeight = rotated ? frame.width : frame.height;
    const quality = assessRgbQuality(input, uprightWidth, uprightHeight);
    const inferenceStarted = performance.now();
    // Keep the model's bounded candidates until hazard ranking; confidence alone
    // must not remove a lower-ranked object directly in the walking corridor.
    const detections = quality.status === "usable"
      ? selectNearFieldDetections(mapDetectionsToImageContent(
        decodeDetections(detector.runSync([input]), labels, 0.45, 25), uprightWidth, uprightHeight)) : [];
    return { quality, detections, imageSize: { width: uprightWidth, height: uprightHeight }, preprocessingMs: inferenceStarted - preprocessingStarted,
      inferenceMs: performance.now() - inferenceStarted };
  } finally {
    try { converted?.dispose(); } finally { frame.dispose(); }
  }
}
