/**
 * Local, constant-space quality hints from a small Y8 (luminance) buffer.
 * The producer must downsample before bridging to JS. No RGB/base64 copy here.
 * This is a prototype heuristic, not object, road or obstacle recognition.
 */
export function analyzeLumaFrame(frame, { signal } = {}) {
  const { data, width, height } = frame;
  const stride = frame.rowStride ?? width;
  if (!(data instanceof Uint8Array) ||
      ![width, height, stride].every(value => Number.isSafeInteger(value) && value > 0) ||
      stride < width || (height - 1) * stride + width > data.length) {
    throw new TypeError("Invalid Y8 frame layout");
  }
  const step = Math.max(1, Math.ceil(Math.max(width, height) / 160));
  let samples = 0, dark = 0, bright = 0, sum = 0, difference = 0, pairs = 0;
  for (let y = 0; y < height; y += step) {
    if (signal?.aborted) throw new Error("Frame analysis cancelled");
    for (let x = 0; x < width; x += step) {
      const value = data[y * stride + x];
      samples += 1;
      sum += value;
      if (value <= 24) dark += 1;
      if (value >= 240) bright += 1;
      if (x + step < width) {
        difference += Math.abs(value - data[y * stride + x + step]);
        pairs += 1;
      }
      if (y + step < height) {
        difference += Math.abs(value - data[(y + step) * stride + x]);
        pairs += 1;
      }
    }
  }
  const edgeMean = pairs ? difference / pairs : 0;
  let reason = null;
  if (Math.min(width, height) < 48) reason = "low_resolution";
  else if (dark / samples >= 0.85) reason = "too_dark";
  else if (bright / samples >= 0.85) reason = "too_bright";
  else if (edgeMean < 1.5) reason = "low_detail";
  return {
    kind: "frame_quality",
    status: reason ? "retake" : "usable",
    reason, meanLuma: sum / samples, edgeMean, sampledPixels: samples,
    navigation_safe: false,
  };
}
