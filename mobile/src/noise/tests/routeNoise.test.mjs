import test from 'node:test';
import assert from 'node:assert/strict';
import { routeNoiseSummary } from '../routeNoise.mjs';

const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

test('route noise uses only cells near the decoded route', () => {
  const result = routeNoiseSummary(encoded, [
    { grid_latitude: 38.5, grid_longitude: -120.2, average_relative_noise: 0.2, measurement_count: 4 },
    { grid_latitude: 0, grid_longitude: 0, average_relative_noise: 1, measurement_count: 100 },
  ]);
  assert.equal(result.cellCount, 1);
  assert.equal(result.relativeNoise, 0.2);
  assert.ok(result.coverageRatio < 0.1, 'a nearby cell must not imply coverage of the whole route');
});

test('route noise remains unknown without nearby aggregate coverage', () => {
  assert.equal(routeNoiseSummary(encoded, [{ grid_latitude: 0, grid_longitude: 0, average_relative_noise: 1, measurement_count: 3 }]), null);
});
