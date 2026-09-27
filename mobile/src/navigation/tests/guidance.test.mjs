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
 assert.equal(guide.update({ ...fix(1), timestamp: 11000 }, 11000), null);
 assert.equal(guide.update({ ...fix(1), timestamp: 12000 }, 12000).kind, 'turn');
 assert.equal(guide.step, 1);
});
test('last point announces proximity rather than verified arrival', () => {
 const guide = new Guidance({ steps: [{ end: endpoint }] });
 assert.equal(guide.update({ ...fix(1), timestamp: 10000 }, 10000), null);
 assert.equal(guide.update({ ...fix(1), timestamp: 11000 }, 11000), null);
 assert.equal(guide.update({ ...fix(1), timestamp: 12000 }, 12000).kind, 'near_destination');
 assert.equal(guide.update({ ...fix(1), timestamp: 13000 }, 13000), null);
});

test('three reliable off-route fixes trigger rerouting once', () => {
 const localRoute = { steps: [{ start: endpoint, end: { latitude: 43.001, longitude: -89 }, instruction: 'Continue.' }] };
 const guide = new Guidance(localRoute);
 const away = { latitude: 43, longitude: -88.999, accuracy: 2, timestamp: 10000 };
 assert.equal(guide.update(away, 10000), null);
 assert.equal(guide.update({ ...away, timestamp: 11000 }, 11000), null);
 assert.equal(guide.update({ ...away, timestamp: 12000 }, 12000).kind, 'off_route');
 assert.equal(guide.update({ ...away, timestamp: 13000 }, 13000), null);
});

test('verified entrance target gets a distinct arrival event', () => {
 const guide = new Guidance({ arrivalTarget: { ...endpoint, verifiedEntrance: true }, steps: [{ start: endpoint, end: endpoint }] });
 assert.equal(guide.update({ ...fix(1), timestamp: 10000 }, 10000), null);
 assert.equal(guide.update({ ...fix(1), timestamp: 11000 }, 11000), null);
 assert.equal(guide.update({ ...fix(1), timestamp: 12000 }, 12000).kind, 'entrance_reached');
});

test('survey accuracy is included in the conservative entrance threshold', () => {
 const guide = new Guidance({ arrivalTarget: { verifiedEntrance: true, accuracyM: 7 }, steps: [{ start: endpoint, end: endpoint }] });
 const near = { ...fix(4), timestamp: 10000 };
 assert.equal(guide.update(near, 10000), null);
 assert.equal(guide.update({ ...near, timestamp: 11000 }, 11000), null);
 assert.equal(guide.update({ ...near, timestamp: 12000 }, 12000), null);
});

test('arrival uses the explicit entrance target instead of a mismatched final step', () => {
 const elsewhere = { latitude: 43.001, longitude: -89 };
 const guide = new Guidance({ arrivalTarget: { ...endpoint, verifiedEntrance: true, accuracyM: 2 }, steps: [{ start: elsewhere, end: elsewhere }] });
 assert.equal(guide.update({ ...fix(1), timestamp: 10000 }, 10000), null);
 assert.equal(guide.update({ ...fix(1), timestamp: 11000 }, 11000), null);
 assert.equal(guide.update({ ...fix(1), timestamp: 12000 }, 12000).kind, 'entrance_reached');
});

test('duplicate fixes cannot trigger off-route or arrival decisions', () => {
 const entrance = new Guidance({ arrivalTarget: { verifiedEntrance: true }, steps: [{ start: endpoint, end: endpoint }] });
 assert.equal(entrance.update(fix(1), 10000), null);
 assert.equal(entrance.update(fix(1), 10000), null);
 assert.equal(entrance.update(fix(1), 10000), null);
 const localRoute = { steps: [{ start: endpoint, end: { latitude: 43.001, longitude: -89 } }] };
 const offRoute = new Guidance(localRoute);
 const away = { latitude: 43, longitude: -88.999, accuracy: 2, timestamp: 10000 };
 assert.equal(offRoute.update(away, 10000), null);
 assert.equal(offRoute.update(away, 10000), null);
 assert.equal(offRoute.update(away, 10000), null);
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

test('five-metre GPS accuracy advances only after consistent waypoint fixes', () => {
 const guide = new Guidance(route);
 guide.update(fix(5), 10000);
 assert.equal(guide.step, 0);
 guide.update({ ...fix(5), timestamp: 11000 }, 11000);
 assert.equal(guide.update({ ...fix(5), timestamp: 12000 }, 12000).kind, 'turn');
 assert.equal(guide.step, 1);
});
test('duplicate turn fixes and rejected GPS locations never advance', () => {
 const guide = new Guidance(route);
 for (let n=0;n<5;n++) guide.update(fix(5), 10000);
 assert.equal(guide.step, 0);
 const rejected = { ...fix(2), timestamp: 12000, trusted: false };
 assert.equal(guide.update(rejected, 12000).kind, 'uncertain');
 assert.equal(guide.step, 0);
});
test('progress along the next segment advances even if the turn waypoint was missed', () => {
 const local = { steps: [{ start: { latitude:43,longitude:-89.001 }, end:endpoint }, { start:endpoint, end:{ latitude:43.001,longitude:-89 }, instruction:'Continue north.' }] };
 const guide = new Guidance(local);
 for (let n=0;n<3;n++) guide.update({ latitude:43.00012, longitude:-89,accuracy:5,timestamp:10000+n*1000 },10000+n*1000);
 assert.equal(guide.step,1);
});
