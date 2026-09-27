/** Close-looking image regions only: no metric range or free-space estimate. */
export function isNearFieldBox(b) {
  "worklet";
  if (!b || !Number.isFinite(b.left) || !Number.isFinite(b.right) ||
      !Number.isFinite(b.top) || !Number.isFinite(b.bottom) || b.left < 0 || b.top < 0 ||
      b.right > 1 || b.bottom > 1 || b.right <= b.left || b.bottom <= b.top) return false;
  const width = b.right - b.left, height = b.bottom - b.top, area = width * height;
  const overlap = Math.max(0, Math.min(b.right, .68) - Math.max(b.left, .32));
  if (overlap / Math.min(width, .36) < .65) return false;
  // Includes partial objects at the lower/side image boundary. Narrow poles and
  // low floor blockers must not satisfy a large-object area threshold.
  return (b.bottom >= .80 && area >= .10) ||
    (b.bottom >= .88 && width >= .05 && height >= .32 && area >= .018) ||
    (b.bottom >= .94 && width >= .16 && height >= .07 && area >= .035) ||
    (area >= .40 && b.top <= .40 && b.bottom >= .65);
}

/** Confidence scales are detector-specific; only bounded recent metadata is used. */
export function confirmedNearField(history, strongScore = .72, repeatedScore = .55, meanScore = .62) {
  const usable = samples => samples.length >= 2 &&
    samples.at(-1).at - samples[0].at >= 180 &&
    samples.at(-1).at - samples[0].at <= 1500 &&
    samples.every((s, i) => Number.isFinite(s.at) && Number.isFinite(s.score) && s.score <= 1 &&
      !s.sceneMotion && isNearFieldBox(s.box) && (i === 0 || (s.at > samples[i - 1].at && s.overlap >= .4)));
  const pair = history.slice(-2);
  if (usable(pair) && pair.every(s => s.score >= strongScore)) return "strong";
  const recent = history.slice(-3);
  if (recent.length === 3 && usable(recent) && recent.at(-1).at - recent[0].at >= 360 &&
      recent.every(s => s.score >= repeatedScore) &&
      recent.reduce((sum, s) => sum + s.score, 0) / recent.length >= meanScore) return "repeated";
  return null;
}

/** Preserve weaker close-looking model candidates without relaxing the whole image. */
export function selectNearFieldDetections(detections) {
  "worklet";
  const selected = [];
  for (const d of detections.slice(0, 25)) {
    if (d.score >= .55) selected.push(d);
    else if (d.score >= .45 && isNearFieldBox(d.box)) selected.push({ ...d, nearCandidate: true });
  }
  return selected;
}
