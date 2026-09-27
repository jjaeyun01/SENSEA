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
  fusion.offerMotion({ acceleration: 0.01, timestamp: 2900 });
  const third = fusion.updateGps({ latitude: 43.001, longitude: -89, accuracy: 4, timestamp: 3000 });
  assert.equal(third.latitude, first.latitude);
  assert.equal(third.source, 'inertial-jump-rejected');
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

test('rejected jumps preserve trusted fix time and consistent new fixes reacquire', () => {
 const fusion = new PositionFusion();
 fusion.updateGps({ latitude:43,longitude:-89,accuracy:3,timestamp:1000 });
 const fix = n => ({ latitude:43.001,longitude:-89,accuracy:3,timestamp:n*1000 });
 const rejected = fusion.updateGps(fix(2));
 assert.equal(rejected.timestamp,1000); assert.equal(rejected.trusted,false);
 assert.equal(fusion.updateGps(fix(3)).trusted,false);
 const recovered = fusion.updateGps(fix(4));
 assert.equal(recovered.source,'gps-reacquired'); assert.equal(recovered.latitude,43.001);
});
test('inconsistent new locations never recover or refresh the accepted fix', () => {
 const fusion = new PositionFusion(); fusion.updateGps({latitude:43,longitude:-89,accuracy:3,timestamp:1000});
 for(let n=2;n<9;n++) {
  const fix = fusion.updateGps({latitude:n%2?43.01:43.02,longitude:-89,accuracy:3,timestamp:n*1000});
  assert.equal(fix.timestamp,1000); assert.equal(fix.trusted,false);
 }
});
function encode(points) {
 let lat=0,lon=0,out='';
 const part = value => { let n=value<0?~(value<<1):value<<1; let str=''; while(n>=32) {str+=String.fromCharCode((32|(n&31))+63);n>>>=5;} return str+String.fromCharCode(n+63); };
 for(const p of points) {const a=Math.round(p.latitude*1e5),b=Math.round(p.longitude*1e5);out+=part(a-lat)+part(b-lon);lat=a;lon=b;}return out;
}
test('curved step geometry does not report a valid bend as off-route', () => {
 const start={latitude:43,longitude:-89},bend={latitude:43.001,longitude:-89},end={latitude:43.001,longitude:-88.9986};
 const encoded_polyline=encode([start,bend,end]);
 assert.ok(routeDistanceMeters({steps:[{start,end,encoded_polyline}]},bend)<1);
 assert.ok(routeDistanceMeters({steps:[{start,end}],encoded_polyline},bend)<1);
});
test('current route geometry does not match a distant future step', () => {
 const here={latitude:43,longitude:-89},future={latitude:44,longitude:-89};
 const steps=Array.from({length:6},(_,i)=>({start:i===5?future:here,end:i===5?future:here,encoded_polyline:encode([i===5?future:here,i===5?future:here])}));
 assert.ok(routeDistanceMeters({steps},future,0)>10000);
});
