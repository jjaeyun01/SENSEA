import { confirmedNearField } from "./near-field.mjs";

/** Image-space priorities. No depth, road segmentation or world trajectory is inferred. */
const targets = [
  ["person", "사람", "dynamic"], ["bicycle", "자전거", "dynamic"],
  ["car", "자동차", "dynamic"], ["motorcycle", "오토바이", "dynamic"],
  ["bus", "버스", "dynamic"], ["truck", "트럭", "dynamic"], ["train", "기차", "dynamic"],
  ["dog", "개", "dynamic"], ["cat", "고양이", "dynamic"],
  ["bench", "벤치", "static"], ["chair", "의자", "static"],
  ["potted plant", "화분", "static"], ["fire hydrant", "소화전", "static"],
  ["parking meter", "주차 요금기", "static"], ["couch", "소파", "static"],
  ["dining table", "식탁", "static"], ["bed", "침대", "static"],
  ["suitcase", "여행 가방", "static"], ["backpack", "가방", "static"],
  ["handbag", "손가방", "static"], ["umbrella", "우산", "static"],
];
const missing = [
  ["e_scooter", "전동 킥보드", "dynamic"],
  ["utility_pole", "전선주", "static"], ["streetlight", "가로등", "static"],
  ["flowerbed", "화단", "static"], ["bollard", "볼라드", "static"],
  ["trash_can", "쓰레기통", "static"], ["construction_cone", "공사 콘", "static"],
  ["barricade", "공사 차단물", "static"],
  ["stairs_up", "올라가는 계단", "elevation"], ["stairs_down", "내려가는 계단", "elevation"],
  ["curb", "연석", "elevation"], ["open_manhole", "열린 맨홀", "elevation"],
  ["construction_drop", "공사 낙차", "elevation"],
  ["low_branch", "낮은 나뭇가지", "overhead"], ["awning", "차양", "overhead"],
  ["open_window", "열린 창문", "overhead"],
];
// A requested class is not a detector capability. No aliases turn a plant into
// a flowerbed, an umbrella into an awning, or a traffic light into a streetlight.
export const HAZARD_TARGETS = Object.freeze([
  ...targets.map(([label, name, kind]) => Object.freeze({ label, name, kind, supported: true })),
  ...missing.map(([label, name, kind]) => Object.freeze({ label, name, kind, supported: false })),
]);
const profiles = new Map(HAZARD_TARGETS.filter(t => t.supported).map(t => [t.label, t]));
export const getHazardProfile = label => profiles.get(label);
export const hazardLabel = label => profiles.get(label)?.name ?? "물체";
export const HAZARD_COVERAGE = Object.freeze([
  ["dynamic", "이동 가능 물체"], ["static", "길을 막는 물체"],
  ["elevation", "단차·낙차"], ["overhead", "머리 위 장애물"],
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
  const inView = relation === "direct" && box.bottom >= 0.67 && size >= minimum;
  const adjacent = relation === "offset" && box.bottom >= 0.55 &&
    (size >= (dynamic ? 0.045 : 0.04) || (dynamic && cues.inwardMotion));
  const movingSide = dynamic && (cues.lateralMotion || cues.inwardMotion) && box.bottom >= 0.55;
  const broadSideVehicle = cues.vehicle && box.bottom >= 0.5 && size >= 0.08;
  let level = inView || adjacent || movingSide || broadSideVehicle ? "caution" : "notice";
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
  if (status === "priority") return { action: "check_priority", guidance: "우선 주의 대상을 먼저 확인해 주세요." };
  if (status === "caution") return { action: "check_surroundings", guidance: "주의 대상의 위치와 주변 상황을 확인해 주세요." };
  if (status === "notice") return { action: "observe", guidance: "주변 물체를 참고로 표시합니다. 통행 가능 여부는 판단하지 않습니다." };
  if (status === "observing") return { action: "observe", guidance: "주변 상황을 계속 확인해 주세요. 감지되지 않은 위험이 있을 수 있습니다." };
  return { action: "unavailable", guidance: "현재 영상으로 판단할 수 없습니다. 촬영 상태를 확인해 주세요." };
}
export const describeScreenRelation = relation => ({ direct: "화면 중앙 관심 영역", offset: "중앙 영역 주변", side: "화면 측면", unknown: "위치 관계 미확인" })[relation] ?? "위치 관계 미확인";
export const describeHazardKind = kind => ({ dynamic: "이동 가능 물체", static: "고정물 후보", elevation: "단차·낙차", overhead: "머리 위 장애물" })[kind] ?? "물체";
