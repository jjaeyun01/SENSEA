import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectVerifiedVpsSource,
  isFreshVisualAlignment,
  subscribeVisualAlignment,
  validateVisualAlignment,
} from '../visualAlignment.mjs';

const sample = {
  latitude: 43.075,
  longitude: -89.4,
  accuracy: 3,
  confidence: 0.95,
  timestamp: 10000,
  verified: true,
  providerId: 'native-vps',
  mapId: 'campus-v1',
  anchorId: 'entrance-42',
};

test('VPS alignment requires a fresh surveyed provider result', () => {
  assert.equal(validateVisualAlignment(sample, 10000)?.anchorId, 'entrance-42');
  assert.equal(validateVisualAlignment({ ...sample, verified: false }, 10000), null);
  assert.equal(validateVisualAlignment({ ...sample, confidence: 0.89 }, 10000), null);
  assert.equal(validateVisualAlignment({ ...sample, accuracy: 11 }, 10000), null);
  assert.equal(validateVisualAlignment({ ...sample, timestamp: 7000 }, 10000), null);
  assert.equal(isFreshVisualAlignment(sample, 10000), true);
});

test('registered VPS source cleans up and clears its last coordinate', () => {
  let emit;
  let sourceCleaned = false;
  const received = [];
  const unsubscribe = subscribeVisualAlignment(value => received.push(value));
  const disconnect = connectVerifiedVpsSource({
    subscribe(listener) {
      emit = listener;
      return () => { sourceCleaned = true; };
    },
  });
  emit({ ...sample, timestamp: Date.now() });
  assert.equal(received.at(-1)?.mapId, 'campus-v1');
  disconnect();
  assert.equal(sourceCleaned, true);
  assert.equal(received.at(-1), null);
  unsubscribe();
});
