import { confirmedNearField } from "./near-field.mjs";

/** Image-space priorities. No depth, road segmentation or world trajectory is inferred. */
const targets = [
  ["person", "Person", "dynamic"], ["bicycle", "Bicycle", "dynamic"],
  ["car", "Car", "dynamic"], ["motorcycle", "Motorcycle", "dynamic"],
  ["bus", "Bus", "dynamic"], ["truck", "Truck", "dynamic"], ["train", "Train", "dynamic"],
  ["dog", "Dog", "dynamic"], ["cat", "Cat", "dynamic"],
  ["bench", "Bench", "static"], ["chair", "Chair", "static"],
  ["potted plant", "Potted plant", "static"], ["fire hydrant", "Fire hydrant", "static"],
  ["parking meter", "Parking meter", "static"], ["couch", "Couch", "static"],
  ["dining table", "Dining table", "static"], ["bed", "Bed", "static"],
  ["suitcase", "Suitcase", "static"], ["backpack", "Backpack", "static"],
  ["handbag", "Handbag", "static"], ["umbrella", "Umbrella", "static"],
];
const missing = [
  ["e_scooter", "E-scooter", "dynamic"],
  ["utility_pole", "Utility pole", "static"], ["streetlight", "Streetlight", "static"],
  ["flowerbed", "Flowerbed", "static"], ["bollard", "Bollard", "static"],
  ["trash_can", "Trash can", "static"], ["construction_cone", "Construction cone", "static"],
  ["barricade", "Construction barrier", "static"],
  ["stairs_up", "Stairs up", "elevation"], ["stairs_down", "Stairs down", "elevation"],
  ["curb", "Curb", "elevation"], ["open_manhole", "Open manhole", "elevation"],
  ["construction_drop", "Construction drop-off", "elevation"],
  ["low_branch", "Low branch", "overhead"], ["awning", "Awning", "overhead"],
  ["open_window", "Open window", "overhead"],
];
// A requested class is not a detector capability. No aliases turn a plant into
// a flowerbed, an umbrella into an awning, or a traffic light into a streetlight.
export const HAZARD_TARGETS = Object.freeze([
  ...targets.map(([label, name, kind]) => Object.freeze({ label, name, kind, supported: true })),
  ...missing.map(([label, name, kind]) => Object.freeze({ label, name, kind, supported: false })),
]);
const profiles = new Map(HAZARD_TARGETS.filter(t => t.supported).map(t => [t.label, t]));
export const getHazardProfile = label => profiles.get(label);
export const hazardLabel = label => profiles.get(label)?.name ?? "Object";
export const HAZARD_COVERAGE = Object.freeze([
  ["dynamic", "Moving objects"], ["static", "Path blockers"],
  ["elevation", "Steps and drop-offs"], ["overhead", "Overhead obstacles"],
].map(([kind, title]) => Object.freeze({ kind, title,
  supported: HAZARD_TARGETS.filter(t => t.kind === kind && t.supported).map(t => t.name).join(" · "),
  unavailable: HAZARD_TARGETS.filter(t => t.kind === kind && !t.supported).map(t => t.name).join(" · "),
})));
export const LEVEL_RANK = Object.freeze({ notice: 0, caution: 1, priority: 2 });
const area = b => (b.right - b.left) * (b.bottom - b.top);
const centerX = b => (b.left + b.right) / 2;
const clamp = (x, low, high) => Math.max(low, Math.min(high, x));

/** Central lower trapezoid proxy only; not the user's confirmed walking path. */
export function screenPathRelation(box) {
  if (box.bottom < 0.45) return "unknown";
  const half = 0.12 + 0.20 * clamp((box.bottom - 0.45) / 0.55, 0, 1);
  const overlap = Math.max(0, Math.min(box.right, 0.5 + half) - Math.max(box.left, 0.5 - half));
  const coversCentre = box.left <= .5 && box.right >= .5 && overlap / Math.min(box.right - box.left, 2 * half) >= .65;
  if (box.bottom >= 0.62 && (overlap / (box.right - box.left) >= 0.60 || coversCentre)) return "direct";
  if (overlap > 0 || Math.abs(centerX(box) - 0.5) <= half + 0.10) return "offset";
  return "side";
}

/** Consistent image movement toward the centre, never a physical velocity/TTC. */
export function movesTowardScreenCenter(history) {
  if (history.length < 3 || history[history.length - 1].at - history[0].at < 400 ||
      history.some(s => s.sceneMotion || s.cropped || s.score < 0.72 || s.overlap < 0.4)) return false;
  const first = history[0], last = history[history.length - 1];
  const start = Math.abs(centerX(first.box) - 0.5), end = Math.abs(centerX(last.box) - 0.5);
  if (start - end < 0.08 || start < 0.15) return false;
  const sign = Math.sign(centerX(first.box) - 0.5);
  for (let i = 1; i < history.length; i++) {
    const a = history[i - 1], b = history[i], change = area(b.box) / area(a.box);
    if (change < 0.7 || change > 1.4 || Math.sign(centerX(b.box) - 0.5) !== sign ||
        Math.abs(centerX(a.box) - 0.5) - Math.abs(centerX(b.box) - 0.5) < 0.02) return false;
  }
  return true;
}

/** Called only after stable association and confidence confirmation. */
export function evaluateHazardPolicy(track, cues) {
  const profile = getHazardProfile(track.label);
  if (!profile) return null;
  const history = track.history, last = history[history.length - 1], box = last.box;
  const size = area(box), relation = screenPathRelation(box), dynamic = profile.kind === "dynamic";
  const minimum = dynamic ? 0.025 : 0.012;
  if (relation === "unknown" || size < minimum) return null;
  // Side observations are informational. A low level does not certify clearance.
  // A foreground-sized central object can occupy the upper/middle image
  // when the phone is tilted. Requiring the lower strip misses this cue.
  // This is apparent image size, not a measured near-distance or collision.
  const largeCentral = centerX(box) >= 0.30 && centerX(box) <= 0.70 &&
    box.bottom >= 0.45 && size >= 0.18;
  const inView = relation === "direct" && box.bottom >= 0.67 && size >= minimum;
  const adjacent = relation === "offset" && box.bottom >= 0.55 &&
    (size >= (dynamic ? 0.045 : 0.04) || (dynamic && cues.inwardMotion));
  const movingSide = dynamic && (cues.lateralMotion || cues.inwardMotion) && box.bottom >= 0.55;
  const broadSideVehicle = cues.vehicle && box.bottom >= 0.5 && size >= 0.08;
  let level = largeCentral || inView || adjacent || movingSide || broadSideVehicle ? "caution" : "notice";
  const span = last.at - history[0].at;
  const strong = history.every(s => s.score >= 0.82 && !s.sceneMotion);
  const nearEvidence = confirmedNearField(history);
  const closeObstacle = relation === "direct" && !!nearEvidence;
  const staticBlocker = !dynamic && closeObstacle;
  const centralMotion = dynamic && relation === "direct" && size >= 0.10 && strong &&
    (cues.growth || cues.inwardMotion);
  if (cues.strongLargeVehicle || closeObstacle || centralMotion) level = "priority";
  const reasons = ["stable_presence"];
  if (relation === "direct" && box.bottom >= 0.67) reasons.push("central_lower");
  if (size >= 0.16) reasons.push("large_image_footprint");
  if (cues.growth) reasons.push("apparent_growth");
  if (cues.inwardMotion) reasons.push("toward_screen_center");
  if (cues.lateralMotion) reasons.push("peripheral_motion");
  if (cues.strongLargeVehicle) reasons.push("strong_vehicle_evidence");
  if (closeObstacle) reasons.push("confirmed_near_obstruction");
  if (closeObstacle && nearEvidence === "repeated") reasons.push("repeated_near_candidate");
  if (staticBlocker) reasons.push("strong_static_obstruction");
  if (dynamic && closeObstacle) reasons.push("strong_near_image_obstruction");
  if (level === "notice") reasons.push("side_observation");
  const base = level === "priority" ? 8 : level === "caution" ? 5 : 1;
  const priorityScore = Math.min(level === "priority" ? 10 : level === "caution" ? 7 : 3,
    base + Number(size >= 0.16) + Number(cues.growth || cues.inwardMotion) + Number(dynamic));
  return { trackId: track.id, label: track.label, direction: track.direction, level, reasons,
    box: { ...box }, kind: profile.kind, mobility: dynamic ? "dynamic_capable" : "usually_static",
    screenRelation: relation, pathInterference: "unknown", distance: "unknown", distanceMeters: null,
    imageScale: size >= 0.18 ? "large" : size >= 0.05 ? "medium" : "small",
    motion: cues.inwardMotion ? "toward_center" : cues.growth ? "growing" : cues.lateralMotion ? "lateral" : "unresolved",
    priorityScore };
}
export function guidanceFor(status) {
  if (status === "priority") return { action: "check_priority", guidance: "Check the highest-priority hazard first." };
  if (status === "caution") return { action: "check_surroundings", guidance: "Check the hazard location and your surroundings." };
  if (status === "notice") return { action: "observe", guidance: "Nearby objects are shown for reference. Path clearance is not established." };
  if (status === "observing") return { action: "observe", guidance: "Keep checking your surroundings. Undetected hazards may be present." };
  return { action: "unavailable", guidance: "Cannot assess the current image. Check the camera view." };
}
export const describeScreenRelation = relation => ({ direct: "Central image region", offset: "Near the central image region", side: "Side of the image", unknown: "Image position unknown" })[relation] ?? "Image position unknown";
export const describeHazardKind = kind => ({ dynamic: "Moving objects", static: "Possible fixed object", elevation: "Steps and drop-offs", overhead: "Overhead obstacles" })[kind] ?? "Object";
