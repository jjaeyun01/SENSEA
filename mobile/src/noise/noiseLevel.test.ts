import { describe, expect, it } from 'vitest';
import { calculateDbfs, classifyDbfs, dbfsToProgress } from './noiseLevel';

describe('continuous noise level calculations', () => {
  it('returns digital full scale for a full amplitude signal', () => {
    expect(calculateDbfs(new Float32Array([1, 1, 1, 1, 1, 1, 1, 1]))).toBeCloseTo(0, 4);
  });

  it('uses a finite floor for silence and rejects no values into infinity', () => {
    expect(calculateDbfs(new Float32Array(32))).toBe(-100);
    expect(Number.isFinite(calculateDbfs(new Float32Array(0)))).toBe(true);
  });

  it('classifies and normalizes device-relative readings', () => {
    expect(classifyDbfs(-60)).toBe('quiet');
    expect(classifyDbfs(-35)).toBe('moderate');
    expect(classifyDbfs(-12)).toBe('loud');
    expect(dbfsToProgress(-60)).toBe(0);
    expect(dbfsToProgress(-30)).toBe(0.5);
    expect(dbfsToProgress(1)).toBe(1);
  });
});
