import { resizeCpuRgbFrame } from "./cpu-rgb.mjs";

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

const KOREAN = {
  person: "사람", bicycle: "자전거", car: "자동차", motorcycle: "오토바이",
  bus: "버스", truck: "트럭", train: "기차", "traffic light": "신호등",
  "stop sign": "정지 표지판", bench: "벤치", chair: "의자", dog: "개", cat: "고양이",
  backpack: "가방", umbrella: "우산", suitcase: "여행 가방",
  "potted plant": "화분", "fire hydrant": "소화전", "parking meter": "주차 요금기",
  couch: "소파", "dining table": "식탁", bed: "침대", handbag: "손가방",
};
export function labelInKorean(label) { return KOREAN[label] ?? label; }

export function describeResult(result) {
  const qualityMessages = {
    too_dark: "영상이 어둡습니다. 조명과 렌즈 가림을 확인해 주세요.",
    too_bright: "영상이 너무 밝습니다. 강한 빛이 들어오는지 확인해 주세요.",
    low_detail: "영상의 세부 정보가 부족합니다. 초점과 촬영 대상을 확인해 주세요.",
    low_resolution: "영상 크기를 확인해 주세요.",
  };
  if (result.quality.reason) return qualityMessages[result.quality.reason] ?? "촬영 상태를 확인해 주세요.";
  const labels = [...new Set(result.detections.map(item => labelInKorean(item.label)))].slice(0, 3);
  return labels.length ? labels.join(", ") + "이 보입니다." : "사물을 식별하지 못했습니다. 사물이 없다는 뜻은 아닙니다.";
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
      ? mapDetectionsToImageContent(decodeDetections(detector.runSync([input]), labels, 0.55, 25),
        uprightWidth, uprightHeight) : [];
    return { quality, detections, imageSize: { width: uprightWidth, height: uprightHeight }, preprocessingMs: inferenceStarted - preprocessingStarted,
      inferenceMs: performance.now() - inferenceStarted };
  } finally {
    try { converted?.dispose(); } finally { frame.dispose(); }
  }
}
