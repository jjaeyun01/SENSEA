/**
 * Rank walking alternatives using evidence, not inferred safety. Unknown path
 * conditions are neutral; a noisy route is never labelled crime-safe.
 * `conditions` must come from a separately verified campus path survey.
 */
export function rankWalkingRoutes(routes, { period = 'day', priority = 'safety', avoidStairs = true, avoidMixedTraffic = true, preferCrosswalks = true, avoidConstruction = true, preferWellLit = false } = {}) {
  if (!routes.length) return [];
  // A confirmed closure is a blocker, including when it is the only option.
  const candidates = routes.filter(route => !(route.conditions?.verified === true && route.conditions.closed === true));
  if (!candidates.length) return [];
  const fastest = Math.min(...candidates.map(route => route.duration_seconds));
  const detourLimit = Math.min(fastest * 1.25, fastest + 300);
  const nonnegative = value => Number.isFinite(value) ? Math.max(0, value) : 0;
  const score = route => {
    const conditions = route.conditions?.verified === true ? route.conditions : null;
    const stairs = nonnegative(conditions?.stairsCount);
    const moderate = nonnegative(conditions?.moderateSlopeMeters);
    const steep = nonnegative(conditions?.steepSlopeMeters);
    const unpaved = nonnegative(conditions?.unpavedMeters);
    const obstructions = nonnegative(conditions?.obstructionCount);
    const mixedTraffic = nonnegative(conditions?.mixedTrafficMeters);
    const unprotectedCrossings = nonnegative(conditions?.unprotectedCrossings);
    const unlit = nonnegative(conditions?.unlitMeters);
    const lit = nonnegative(conditions?.litMeters);
    const construction = conditions?.construction === true;
    const withinDetour = route.duration_seconds <= detourLimit;
    // A detour limit applies to comfort signals, never to a verified path hazard.
    const safetyWeight = priority === 'safety' ? 1.5 : 1;
    const slopeWeight = priority === 'flat' ? 2 : 1;
    const accessibility = safetyWeight * (obstructions * 1000 + mixedTraffic * (avoidMixedTraffic ? 5 : 1) +
      unprotectedCrossings * (preferCrosswalks ? 300 : 100)) +
      stairs * (avoidStairs || priority === 'flat' ? 900 : 300) +
      slopeWeight * (steep * 8 + moderate * 3 + unpaved * 0.6);
    const constructionCost = avoidConstruction && construction ? 2000 : 0;
    const mapped = nonnegative(conditions?.mappedMeters);
    const litCoverage = mapped > 0 ? Math.min(1, lit / mapped) : 0;
    const unlitCoverage = mapped > 0 ? Math.min(1, unlit / mapped) : 0;
    const credibleNoise = route.noiseStatus === 'fresh' && route.noiseCoverage >= 0.7 && route.noiseMeasurementCount >= 10 && route.noiseContributorCount >= 3 && Number.isFinite(route.relativeNoise);
    const noise = credibleNoise ? route.relativeNoise : null;
    const nightEvidence = period === 'night' && withinDetour ? unlitCoverage * 180 - litCoverage * (preferWellLit ? 150 : 100) - (noise ?? 0) * 45 : 0;
    const dayNoise = period === 'day' && withinDetour && noise !== null ? noise * 30 : 0;
    const timeWeight = priority === 'fastest' ? 2 : 1;
    return route.duration_seconds * timeWeight + accessibility + constructionCost + nightEvidence + dayNoise;
  };
  return candidates.sort((a, b) => score(a) - score(b) || a.duration_seconds - b.duration_seconds || String(a.id).localeCompare(String(b.id)));
}
