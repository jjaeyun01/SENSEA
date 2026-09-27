import test from 'node:test';
import assert from 'node:assert/strict';
import { gridForLocation, relativeNoiseFromDbfs, summarizeDbfs } from '../noiseMath.mjs';

test('nearby coordinates are reduced to the same coarse grid cell', () => {
  const a = gridForLocation(43.07301, -89.40101);
  const b = gridForLocation(43.07305, -89.40105);
  assert.equal(a.id, b.id);
  assert.notEqual(a.latitude, 43.07301);
});

test('relative noise is bounded and never presented as calibrated dBA', () => {
  assert.equal(relativeNoiseFromDbfs(-100), 0);
  assert.equal(relativeNoiseFromDbfs(-10), 1);
  assert.ok(relativeNoiseFromDbfs(-45) > 0 && relativeNoiseFromDbfs(-45) < 1);
});

test('dBFS samples are averaged in the power domain', () => {
  const result = summarizeDbfs([-40, -40, -40, -40]);
  assert.equal(result.averageDbfs, -40);
  assert.equal(result.peakDbfs, -40);
  assert.equal(result.sampleCount, 4);
});

test('invalid or insufficient samples are rejected', () => {
  assert.throws(() => summarizeDbfs([-40, Number.NaN]));
});
