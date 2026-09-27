import { getHazardProfile, hazardLabel, evaluateHazardPolicy, movesTowardScreenCenter, guidanceFor, LEVEL_RANK } from "./hazard-policy.mjs";

import { automaticWarnings } from "./automatic-speech.mjs";
import { isNearFieldBox, confirmedNearField } from "./near-field.mjs";

/**
 * Image-only attention cues, not a collision predictor or a navigable-path model.
 * All thresholds below are provisional, uncalibrated heuristics. They need
 * recorded-scene and device validation before any real-world safety claims.
 * Input boxes MUST describe upright image content, with letterbox bars removed.
 * No pixels, metric distances, TTC estimates, or unbounded event logs are kept.
 */
export const HAZARD_LIMITS = Object.freeze({
  maxInputDetections: 25, maxTracks: 12, maxHistory: 4, maxHazards: 3,
  freshnessMs: 1000, maxSampleGapMs: 1000, historyWindowMs: 1500, minConfirmationMs: 180,
  minGrowthSpanMs: 400, minScore: 0.62,
});

const VEHICLES = new Set(["bicycle", "car", "motorcycle", "bus", "truck", "train"]);
const DIRECTIONS = { left: "화면 왼쪽", center: "화면 중앙", right: "화면 오른쪽" };
const NONE = "위험 요소를 관찰 중입니다. 감지되지 않은 위험이 있을 수 있습니다.";
const UNAVAILABLE = "현재 영상으로 위험 요소를 판단할 수 없습니다.";
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const fromEnd = (items, offset = 1) => items[items.length - offset];
const center = b => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });
const area = b => (b.right - b.left) * (b.bottom - b.top);
const clipped = b => b.left <= 0.025 || b.right >= 0.975 || b.top <= 0.025 || b.bottom >= 0.975;
function intersection(a, b) {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
}
function iou(a, b) { const n = intersection(a, b); return n / (area(a) + area(b) - n); }
function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)];
}
function direction(box, previous) {
  const x = center(box).x;
  // Hysteresis prevents left/center/right speech from boundary jitter.
  if (previous === "left" && x < 0.39) return "left";
  if (previous === "right" && x > 0.61) return "right";
  if (previous === "center" && x >= 0.30 && x <= 0.70) return "center";
  return x < 0.35 ? "left" : x > 0.65 ? "right" : "center";
}
function inAttentionZone(b) {
  // A screen-space cue only. The camera may point away from the walking path.
  return center(b).x >= 0.2 && center(b).x <= 0.8 && b.bottom >= 0.67;
}
function centralLargeVehicle(sample) {
  const b = sample.box, x = center(b).x;
  return x >= 0.35 && x <= 0.65 && b.bottom >= 0.84 &&
    area(b) >= 0.22 && b.right - b.left >= 0.35 && sample.score >= 0.82;
}
function describeHazard(hazard) {
  const position = DIRECTIONS[hazard.direction];
  const label = hazardLabel(hazard.label);
  const lead = hazard.level === "priority" ? "우선 주의. " : hazard.level === "notice" ? "참고. " : "주의. ";
  const ending = label.charCodeAt(label.length - 1) - 0xac00;
  const subject = label + (ending >= 0 && ending <= 11171 && ending % 28 ? "이" : "가");
  if (hazard.reasons.includes("toward_screen_center")) {
    return `${lead}${position}의 ${label} 영상이 화면 중앙 쪽으로 이동하고 있습니다.`;
  }
  if (hazard.level === "notice") return `${lead}${position}에 ${subject} 반복해서 보입니다. 이동 가능 여부는 판단하지 않습니다.`;
  if (hazard.reasons.includes("apparent_growth")) {
    return `${lead}${position}에서 ${label}의 영상 크기가 커지고 있습니다. 실제 거리는 알 수 없습니다.`;
  }
  if (hazard.reasons.includes("peripheral_motion")) {
    return `${lead}${position}에서 ${label}의 영상 위치가 빠르게 바뀌고 있습니다.`;
  }
  if (hazard.reasons.includes("large_image_footprint")) {
    return `${lead}${position}에 크게 보이는 ${subject} 있습니다.`;
  }
  return `${lead}${position} 아래쪽에 ${subject} 반복해서 보입니다.`;
}
// Keep automatic speech brief; full evidence/limitations remain in the screen summary.
function describeHazardForSpeech(hazard) {
  const lead = hazard.level === "priority" ? "우선 주의. " : hazard.level === "notice" ? "참고. " : "주의. ";
  const target = `${DIRECTIONS[hazard.direction]} ${hazardLabel(hazard.label)}. `;
  const cue = hazard.reasons.includes("toward_screen_center") ? "화면 중앙 쪽으로 움직입니다." :
    hazard.reasons.includes("apparent_growth") ? "화면에서 커져 보입니다." :
    hazard.reasons.includes("peripheral_motion") ? "화면에서 위치가 바뀝니다." :
    hazard.reasons.includes("large_image_footprint") ? "화면에 크게 보입니다." : "아래쪽에 보입니다.";
  return lead + target + cue;
}
function cloneAssessment(value) {
  return { ...value, hazards: value.hazards.map(h => ({ ...h, box: { ...h.box }, reasons: [...h.reasons] })) };
}
function sanitizeDetections(input) {
  const result = [];
  // Slice BEFORE validation/sorting; detector output cannot cause an unbounded scan.
  for (const raw of input.slice(0, HAZARD_LIMITS.maxInputDetections)) {
    if (!raw || !getHazardProfile(raw.label) || !Number.isFinite(raw.score) ||
        raw.score < (isNearFieldBox(raw.box) ? .50 : HAZARD_LIMITS.minScore) || raw.score > 1 || !raw.box) continue;
    const b = raw.box;
    if (![b.top, b.left, b.bottom, b.right].every(Number.isFinite) ||
        b.left < 0 || b.top < 0 || b.right > 1 || b.bottom > 1 ||
        b.right <= b.left || b.bottom <= b.top || area(b) < 0.001) continue;
    if (raw.classId !== undefined && (!Number.isInteger(raw.classId) || raw.classId < 0)) continue;
    result.push({ label: raw.label, classId: raw.classId, score: raw.score,
      box: { top: b.top, left: b.left, bottom: b.bottom, right: b.right } });
  }
  result.sort((a, b) => b.score - a.score);
  const unique = [];
  for (const item of result) {
    if (unique.some(other => item.label === other.label &&
      (iou(item.box, other.box) >= 0.78 ||
       (intersection(item.box, other.box) / Math.min(area(item.box), area(other.box)) >= 0.9 &&
        Math.hypot(center(item.box).x - center(other.box).x, center(item.box).y - center(other.box).y) < 0.05)))) continue;
    unique.push(item);
  }
  // Ranking reserves space for large/lower vehicle cues. Confidence is a validity
  // threshold/tie-breaker, never presented as a probability of danger.
  unique.sort((a, b) => visualRank(b) - visualRank(a) || b.score - a.score);
  return unique.slice(0, HAZARD_LIMITS.maxTracks);
}
function visualRank(d) {
  return (isNearFieldBox(d.box) ? 3 : 0) + (inAttentionZone(d.box) ? 2 : 0) + (VEHICLES.has(d.label) ? 1 : 0) + area(d.box);
}
function matchesClass(track, detection) {
  return track.label === detection.label && track.classId === detection.classId;
}
function candidateFor(track, detection, at) {
  const latest = fromEnd(track.history), b = detection.box;
  const overlap = iou(latest.box, b), ratio = area(b) / area(latest.box);
  if (overlap < 0.25 || ratio < 0.45 || ratio > 2.2) return null;
  const a = center(latest.box), target = center(b);
  let px = a.x, py = a.y;
  // A bounded linear prediction helps same-class crossing; ambiguity still resets
  // evidence. This is association only, not an estimate of physical velocity.
  const previous = fromEnd(track.history, 2);
  if (previous && latest.at > previous.at && !track.missed) {
    const before = center(previous.box);
    const factor = Math.min(1.5, (at - latest.at) / (latest.at - previous.at));
    px += clamp((a.x - before.x) * factor, -0.1, 0.1);
    py += clamp((a.y - before.y) * factor, -0.1, 0.1);
  }
  const distance = Math.hypot(px - target.x, py - target.y);
  if (Math.hypot(a.x - target.x, a.y - target.y) > 0.18 || distance > 0.18) return null;
  return { overlap, score: overlap * 0.65 + (1 - distance / 0.18) * 0.35 };
}
function commonSceneMotion(transitions) {
  const reliable = transitions.filter(t => t.overlap >= 0.45 && !t.cropped);
  if (reliable.length < 3) return false;
  const dx = median(reliable.map(t => t.dx)), dy = median(reliable.map(t => t.dy));
  const logScale = median(reliable.map(t => Math.log(t.scale)));
  const need = Math.ceil(reliable.length * 0.67);
  const pan = Math.hypot(dx, dy) >= 0.025 &&
    reliable.filter(t => Math.hypot(t.dx - dx, t.dy - dy) <= 0.025).length >= need;
  const zoom = Math.abs(logScale) >= Math.log(1.045) &&
    reliable.filter(t => Math.abs(Math.log(t.scale) - logScale) <= 0.055).length >= need;
  return pan || zoom;
}
function apparentGrowth(history) {
  if (history.length < 3 || fromEnd(history).at - history[0].at < HAZARD_LIMITS.minGrowthSpanMs ||
      history.some(s => s.cropped || s.sceneMotion || s.score < 0.72)) return false;
  const first = history[0], last = fromEnd(history);
  if (area(last.box) / area(first.box) < 1.65) return false;
  const firstAspect = (first.box.right - first.box.left) / (first.box.bottom - first.box.top);
  const lastAspect = (last.box.right - last.box.left) / (last.box.bottom - last.box.top);
  if (lastAspect / firstAspect < 0.78 || lastAspect / firstAspect > 1.28) return false;
  if (Math.hypot(center(first.box).x - center(last.box).x, center(first.box).y - center(last.box).y) > 0.14) return false;
  let gains = 0;
  for (let i = 1; i < history.length; i++) {
    const before = history[i - 1], after = history[i];
    const scale = area(after.box) / area(before.box);
    const oldAspect = (before.box.right - before.box.left) / (before.box.bottom - before.box.top);
    const newAspect = (after.box.right - after.box.left) / (after.box.bottom - after.box.top);
    if (after.overlap < 0.4 || scale <= 1 || scale > 1.8 || newAspect / oldAspect < 0.78 || newAspect / oldAspect > 1.28) return false;
    if (scale >= 1.08) gains++;
  }
  return gains >= 2;
}
function peripheralMotion(history) {
  if (history.length < 3 || history.some(s => s.sceneMotion || s.cropped || s.overlap < 0.4)) return false;
  const first = history[0], last = fromEnd(history), dt = last.at - first.at;
  if (dt < 400) return false;
  const dx = center(last.box).x - center(first.box).x;
  if (Math.abs(dx) < 0.1 || Math.abs(dx) / (dt / 1000) < 0.22) return false;
  for (let i = 1; i < history.length; i++) {
    const step = center(history[i].box).x - center(history[i - 1].box).x;
    if (Math.sign(step) !== Math.sign(dx) || Math.abs(step) < 0.015) return false;
  }
  return true;
}
function assessTrack(track) {
  const history = track.history, latest = fromEnd(history), box = latest.box;
  const nearEvidence = confirmedNearField(history);
  if (history.length < 2 || latest.at - history[0].at < HAZARD_LIMITS.minConfirmationMs ||
      (!nearEvidence && (history.some(s => s.score < 0.65) ||
       history.reduce((sum, s) => sum + s.score, 0) / history.length < 0.72))) return null;
  const vehicle = VEHICLES.has(track.label);
  const dynamic = getHazardProfile(track.label)?.kind === "dynamic";
  return evaluateHazardPolicy(track, {
    vehicle, growth: apparentGrowth(history),
    lateralMotion: dynamic && peripheralMotion(history),
    inwardMotion: dynamic && movesTowardScreenCenter(history),
    strongLargeVehicle: vehicle && history.slice(-2).every(centralLargeVehicle),
  });
}

export class HazardTracker {
  constructor() { this.reset(); }
  reset() {
    this.tracks = [];
    this.nextId = 1;
    this.lastFrameAt = -Infinity;
    this.lastNow = -Infinity;
    this.lastAssessment = { status: "unavailable", summary: UNAVAILABLE, hazards: [],
      observedAt: 0, navigation_safe: false, confirmedCount: 0, warningCount: 0, ...guidanceFor("unavailable") };
  }
  getDiagnostics() {
    return { trackCount: this.tracks.length,
      sampleCount: this.tracks.reduce((n, track) => n + track.history.length, 0),
      maxHistory: Math.max(0, ...this.tracks.map(t => t.history.length)) };
  }
  /** @returns {import('./types').HazardAssessment} */
  update(result, now) {
    const at = result?.receivedAt, age = now - at;
    if (!Number.isFinite(now) || now < 0 || now < this.lastNow ||
        !Number.isFinite(at) || !Number.isFinite(age) || age < 0 || age > HAZARD_LIMITS.freshnessMs ||
        result?.error || result?.quality?.status !== "usable" || result.quality.reason != null ||
        !Array.isArray(result.detections)) {
      this.reset();
      this.lastNow = Number.isFinite(now) && now >= 0 ? now : -Infinity;
      this.lastAssessment.observedAt = Number.isFinite(now) && now >= 0 ? now : 0;
      return cloneAssessment(this.lastAssessment);
    }
    this.lastNow = now;
    // Replaying or reordering a frame cannot manufacture temporal evidence.
    if (at <= this.lastFrameAt) return cloneAssessment(this.lastAssessment);
    if (at - this.lastFrameAt > HAZARD_LIMITS.maxSampleGapMs) this.tracks = [];
    this.lastFrameAt = at;
    this.tracks = this.tracks.filter(t => at - t.lastSeen <= HAZARD_LIMITS.maxSampleGapMs);
    const detections = sanitizeDetections(result.detections);
    const candidates = [];
    for (let ti = 0; ti < this.tracks.length; ti++) {
      for (let di = 0; di < detections.length; di++) {
        if (!matchesClass(this.tracks[ti], detections[di])) continue;
        const match = candidateFor(this.tracks[ti], detections[di], at);
        if (match) candidates.push({ ...match, ti, di });
      }
    }
    candidates.sort((a, b) => b.score - a.score || a.ti - b.ti || a.di - b.di);
    const usedTracks = new Set(), usedDetections = new Set(), transitions = [];
    for (const match of candidates) {
      if (usedTracks.has(match.ti) || usedDetections.has(match.di)) continue;
      const track = this.tracks[match.ti], detection = detections[match.di];
      const before = fromEnd(track.history), oldCenter = center(before.box), newCenter = center(detection.box);
      const ambiguous = candidates.some(other => other !== match &&
        ((other.ti === match.ti && other.di !== match.di) || (other.di === match.di && other.ti !== match.ti)) &&
        Math.abs(other.score - match.score) < 0.1);
      const uncertain = ambiguous || track.missed || match.overlap < 0.4 || at - before.at > HAZARD_LIMITS.maxSampleGapMs;
      if (uncertain) track.history = [];
      const sample = { at, box: detection.box, score: detection.score, overlap: match.overlap,
        cropped: clipped(detection.box), sceneMotion: false };
      if (!uncertain) transitions.push({ overlap: match.overlap, cropped: sample.cropped || before.cropped,
        dx: newCenter.x - oldCenter.x, dy: newCenter.y - oldCenter.y,
        scale: Math.sqrt(area(detection.box) / area(before.box)) });
      track.history.push(sample);
      track.history = track.history.filter(s => at - s.at <= HAZARD_LIMITS.historyWindowMs).slice(-HAZARD_LIMITS.maxHistory);
      track.lastSeen = at;
      track.direction = direction(detection.box, track.direction);
      track.missed = false;
      usedTracks.add(match.ti); usedDetections.add(match.di);
    }
    for (let ti = 0; ti < this.tracks.length; ti++) {
      if (!usedTracks.has(ti)) this.tracks[ti].missed = true;
    }
    // Missing objects are not output. They retain only a short association hint,
    // and their temporal evidence restarts if seen again.
    this.tracks.sort((a, b) => Number(a.missed) - Number(b.missed) || b.lastSeen - a.lastSeen);
    for (let di = 0; di < detections.length; di++) {
      if (usedDetections.has(di)) continue;
      if (this.tracks.length >= HAZARD_LIMITS.maxTracks) {
        let missing = -1;
        for (let index = this.tracks.length - 1; index >= 0; index--) {
          if (this.tracks[index].missed) { missing = index; break; }
        }
        if (missing === -1) break;
        this.tracks.splice(missing, 1);
      }
      const d = detections[di];
      this.tracks.push({ id: this.nextId++, classId: d.classId, label: d.label,
        direction: direction(d.box), lastSeen: at, missed: false,
        history: [{ at, box: d.box, score: d.score, overlap: 1,
          cropped: clipped(d.box), sceneMotion: false }] });
    }
    if (commonSceneMotion(transitions)) {
      for (const track of this.tracks) if (!track.missed) fromEnd(track.history).sceneMotion = true;
    }
    const confirmed = this.tracks.filter(t => !t.missed && t.lastSeen === at)
      .map(track => ({ hazard: assessTrack(track), rank: visualRank({ label: track.label, box: fromEnd(track.history).box }) }))
      .filter(item => item.hazard)
      .sort((a, b) => LEVEL_RANK[b.hazard.level] - LEVEL_RANK[a.hazard.level] ||
        b.hazard.priorityScore - a.hazard.priorityScore || b.rank - a.rank || a.hazard.trackId - b.hazard.trackId)
      .map(item => item.hazard);
    const hazards = confirmed.slice(0, HAZARD_LIMITS.maxHazards), status = hazards[0]?.level ?? "observing";
    this.lastAssessment = { status,
      summary: hazards.length ? hazards.slice(0, 2).map(describeHazard).join(" ") : NONE,
      hazards, observedAt: at, navigation_safe: false, confirmedCount: confirmed.length,
      warningCount: confirmed.filter(h => h.level !== "notice").length, ...guidanceFor(status) };
    return cloneAssessment(this.lastAssessment);
  }
}

/** Bounded speech decisions; caller replaces current speech, never queues it. */
export class HazardAnnouncementGate {
  constructor() { this.reset(); }
  reset() {
    this.entries = [];
    this.lastFrameAt = -Infinity;
    this.lastNow = -Infinity;
    this.lastAt = -Infinity;
    this.lastPriorityAt = -Infinity;
  }
  getDiagnostics() { return { entryCount: this.entries.length }; }
  /** @param {import('./types').HazardAssessment} assessment @returns {string | null} */
  offer(assessment, now) {
    const age = now - assessment?.observedAt;
    if (!Number.isFinite(now) || now < this.lastNow || !Number.isFinite(age) || age < 0 ||
        age > HAZARD_LIMITS.freshnessMs || assessment?.status === "unavailable") {
      this.reset();
      return null;
    }
    this.lastNow = now;
    if (assessment.observedAt <= this.lastFrameAt) return null;
    this.lastFrameAt = assessment.observedAt;
    // Informational side objects remain on screen/manual replay and never interrupt warnings.
    const hazards = automaticWarnings(assessment).slice(0, HAZARD_LIMITS.maxHazards);
    const activeIds = new Set(hazards.map(h => h.trackId));
    this.entries = this.entries.filter(entry => now - entry.seenAt <= 12000);
    for (const entry of this.entries) {
      if (!activeIds.has(entry.id) && entry.absentSince === null) entry.absentSince = now;
    }
    for (const hazard of hazards) {
      let entry = this.entries.find(e => e.id === hazard.trackId);
      if (!entry) {
        if (this.entries.length >= 6) {
          this.entries.sort((a, b) => a.seenAt - b.seenAt);
          this.entries.shift();
        }
        entry = { id: hazard.trackId, level: null, direction: null, spokenAt: -Infinity,
          seenAt: now, absentSince: null, rearmed: false };
        this.entries.push(entry);
      }
      entry.seenAt = now;
      if (entry.absentSince !== null && now - entry.absentSince >= 2500) entry.rearmed = true;
      entry.absentSince = null;
    }
    for (const hazard of [...hazards].sort((a, b) => Number(b.level === "priority") - Number(a.level === "priority"))) {
      const entry = this.entries.find(e => e.id === hazard.trackId);
      const escalation = hazard.level === "priority" && entry.level !== "priority";
      const changed = entry.direction !== hazard.direction;
      if (!escalation && !changed && !entry.rearmed && now - entry.spokenAt < 8000) continue;
      // Priority escalation bypasses the ordinary four-second cooldown. A short
      // priority-only guard stops several new tracks interrupting speech at once.
      if (escalation ? now - this.lastPriorityAt < 1500 : now - this.lastAt < 4000) continue;
      entry.level = hazard.level; entry.direction = hazard.direction; entry.spokenAt = now; entry.rearmed = false;
      this.lastAt = now;
      if (hazard.level === "priority") this.lastPriorityAt = now;
      return describeHazardForSpeech(hazard);
    }
    return null;
  }
}
