import test from 'node:test';
import assert from 'node:assert/strict';
import { Guidance } from '../guidance.mjs';
const endpoint = { latitude: 43, longitude: -89 };
const route = { steps: [{ end: endpoint }, { end: { latitude: 44, longitude: -89 }, instruction: 'Turn left.' }] };
const fix = (accuracy, offset = 0) => ({ ...endpoint, latitude: 43 + offset, accuracy, timestamp: 10000 });
test('stale or inaccurate positions never advance', () => {
 const guide = new Guidance(route);
 assert.equal(guide.update(fix(20), 10000).kind, 'uncertain');
 assert.equal(guide.update(fix(1), 17000).kind, 'uncertain');
 assert.equal(guide.step, 0);
});
test('10m warning does not claim 3m precision and is emitted once', () => {
 const guide = new Guidance(route);
 assert.equal(guide.update(fix(4, 0.00003), 10000).kind, 'approaching');
 assert.equal(guide.update(fix(4, 0.00003), 10000), null);
 assert.equal(guide.step, 0);
 assert.equal(guide.update(fix(1), 10000).kind, 'turn');
 assert.equal(guide.step, 1);
});
test('last point announces proximity rather than verified arrival', () => {
 const guide = new Guidance({ steps: [{ end: endpoint }] });
 assert.equal(guide.update(fix(1), 10000).kind, 'near_destination');
 assert.equal(guide.update(fix(1), 10000), null);
});

test('decode route polyline and reject truncation', async () => {
 const { decodePolyline } = await import('../guidance.mjs');
 assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [
   { latitude: 38.5, longitude: -120.2 },
   { latitude: 40.7, longitude: -120.95 },
   { latitude: 43.252, longitude: -126.453 },
 ]);
 assert.throws(() => decodePolyline('_p~iF~'));
});
