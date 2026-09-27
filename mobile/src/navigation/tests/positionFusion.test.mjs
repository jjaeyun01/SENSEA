import test from 'node:test';
import assert from 'node:assert/strict';
import { PositionFusion, distanceToSegmentMeters, routeDistanceMeters } from '../positionFusion.mjs';

test('distance to route uses step geometry', () => {
  const route = { steps: [{ start: { latitude: 43, longitude: -89 }, end: { latitude: 43, longitude: -88.999 } }] };
  assert.ok(distanceToSegmentMeters({ latitude: 43.0001, longitude: -88.9995 }, route.steps[0].start, route.steps[0].end) > 10);
  assert.ok(routeDistanceMeters(route, { latitude: 43, longitude: -88.9995 }) < 1);
});

test('fusion rejects a large GPS jump while inertial data says stationary', () => {
  const fusion = new PositionFusion();
  const first = fusion.updateGps({ latitude: 43, longitude: -89, accuracy: 4, timestamp: 1000 });
  fusion.offerMotion({ acceleration: 0.02, timestamp: 1900 });
  const second = fusion.updateGps({ latitude: 43.001, longitude: -89, accuracy: 4, timestamp: 2000 });
  assert.equal(second.latitude, first.latitude);
  assert.equal(second.source, 'inertial-jump-rejected');
});

test('fusion accepts only nearby verified VPS corrections', () => {
  const fusion = new PositionFusion();
  const corrected = fusion.updateGps({ latitude: 43, longitude: -89, accuracy: 8, timestamp: 1000 },
    { latitude: 43.00002, longitude: -89, accuracy: 3, timestamp: 1000, confidence: 0.95, verified: true });
  assert.equal(corrected.source, 'gps+verified-vps');
  const rejected = new PositionFusion().updateGps({ latitude: 43, longitude: -89, accuracy: 8, timestamp: 1000 },
    { latitude: 44, longitude: -89, accuracy: 3, timestamp: 1000, confidence: 0.99, verified: true });
  assert.equal(rejected.source, 'gps');
});
