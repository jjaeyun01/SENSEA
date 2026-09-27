/** People remain in detection, overlays, manual replay and haptics.
 * @param {{ label: string }} item
 */
export function isAutomaticSpeechTarget(item) {
  return item.label !== "person";
}

/** Use the same target policy for speech selection, cancellation and arbitration.
 * @param {import('./types').HazardAssessment | null | undefined} assessment
 */
export function automaticWarnings(assessment) {
  return (assessment?.hazards ?? []).filter(item =>
    item.level !== "notice" && isAutomaticSpeechTarget(item));
}
