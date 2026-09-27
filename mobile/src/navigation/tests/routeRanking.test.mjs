import test from 'node:test';
import assert from 'node:assert/strict';
import { rankWalkingRoutes } from '../routeRanking.mjs';

const route = (id, seconds, extra = {}) => ({ id, duration_seconds: seconds, ...extra });

test('unknown conditions do not become claims of accessible or well-lit paths', () => {
  const ranked = rankWalkingRoutes([route('long', 800), route('short', 600)], { period: 'night', priority: 'stepFree' });
  assert.deepEqual(ranked.map(item => item.id), ['short', 'long']);
});

test('verified steep slopes and stairs lose to a modest accessible detour', () => {
  const ranked = rankWalkingRoutes([
    route('steep', 600, { conditions: { verified: true, mappedMeters: 500, steepSlopeMeters: 100, stairsCount: 1 } }),
    route('gentle', 690, { conditions: { verified: true, mappedMeters: 550, steepSlopeMeters: 0, stairsCount: 0 } }),
  ], { period: 'day', avoidStairs: true });
  assert.equal(ranked[0].id, 'gentle');
});

test('a surveyed obstruction takes precedence over a small time saving', () => {
  const ranked = rankWalkingRoutes([
    route('obstructed', 600, { conditions: { verified: true, obstructionCount: 1 } }),
    route('clearer', 650, { conditions: { verified: true, obstructionCount: 0 } }),
  ], { period: 'day' });
  assert.equal(ranked[0].id, 'clearer');
});

test('a verified obstruction is not suppressed by the comfort detour limit', () => {
  const ranked = rankWalkingRoutes([
    route('obstructed', 600, { conditions: { verified: true, obstructionCount: 1 } }),
    route('clearer', 780, { conditions: { verified: true, obstructionCount: 0 } }),
  ], { period: 'day' });
  assert.equal(ranked[0].id, 'clearer');
});

test('unverified condition labels cannot influence ranking', () => {
  const ranked = rankWalkingRoutes([
    route('short', 600, { conditions: { verified: false, closed: true, steepSlopeMeters: 500 } }),
    route('long', 650),
  ]);
  assert.equal(ranked[0].id, 'short');
});

test('night noise needs substantial route coverage and cannot justify a large detour', () => {
  const short = route('short', 600, { relativeNoise: 0.2, noiseStatus: 'fresh', noiseCoverage: 0.8, noiseMeasurementCount: 20, noiseContributorCount: 3 });
  const covered = route('covered', 615, { relativeNoise: 0.8, noiseStatus: 'fresh', noiseCoverage: 0.8, noiseMeasurementCount: 20, noiseContributorCount: 3 });
  const sparse = route('sparse', 605, { relativeNoise: 1, noiseStatus: 'fresh', noiseCoverage: 0.1, noiseMeasurementCount: 20, noiseContributorCount: 3 });
  const far = route('far', 950, { relativeNoise: 1, noiseStatus: 'fresh', noiseCoverage: 1, noiseMeasurementCount: 100, noiseContributorCount: 3 });
  assert.equal(rankWalkingRoutes([short, covered, sparse, far], { period: 'night' })[0].id, 'covered');
  assert.equal(rankWalkingRoutes([short, sparse], { period: 'night' })[0].id, 'short');
  assert.equal(rankWalkingRoutes([short, far], { period: 'night' })[0].id, 'short');
});

test('verified lighting can favour a modest night detour but does not override closures', () => {
  const dark = route('dark', 600, { conditions: { verified: true, mappedMeters: 500, unlitMeters: 500 } });
  const lit = route('lit', 650, { conditions: { verified: true, mappedMeters: 500, litMeters: 500 } });
  const closed = route('closed', 590, { conditions: { verified: true, closed: true, mappedMeters: 500, litMeters: 500 } });
  assert.deepEqual(rankWalkingRoutes([closed, dark, lit], { period: 'night', preferWellLit: true }).map(item => item.id), ['lit', 'dark']);
  assert.deepEqual(rankWalkingRoutes([closed], { period: 'night' }), []);
});

test('account flat priority and crossing preferences affect surveyed alternatives', () => {
  const steep = route('steep', 600, { conditions: { verified: true, steepSlopeMeters: 40, unprotectedCrossings: 0 } });
  const crosswalk = route('crosswalk', 670, { conditions: { verified: true, steepSlopeMeters: 0, unprotectedCrossings: 1 } });
  assert.equal(rankWalkingRoutes([steep, crosswalk], { priority: 'flat', preferCrosswalks: false })[0].id, 'crosswalk');
  assert.equal(rankWalkingRoutes([steep, crosswalk], { priority: 'balanced', preferCrosswalks: true })[0].id, 'steep');
});

test('account mixed-traffic avoidance changes the route order only for verified conditions', () => {
  const mixed = route('mixed', 600, { conditions: { verified: true, mixedTrafficMeters: 50 } });
  const separated = route('separated', 660, { conditions: { verified: true, mixedTrafficMeters: 0 } });
  assert.equal(rankWalkingRoutes([mixed, separated], { priority: 'balanced', avoidMixedTraffic: true })[0].id, 'separated');
  assert.equal(rankWalkingRoutes([mixed, separated], { priority: 'balanced', avoidMixedTraffic: false })[0].id, 'mixed');
});
