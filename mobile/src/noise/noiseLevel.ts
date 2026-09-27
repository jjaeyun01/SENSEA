export type NoiseBand = 'quiet' | 'moderate' | 'loud';

const MIN_DBFS = -100;

/**
 * Calculates a device-relative RMS level in decibels below digital full scale.
 * This is not calibrated dB SPL and must never be presented as a certified sound level.
 */
export function calculateDbfs(samples: Float32Array) {
  if (!samples.length) return MIN_DBFS;
  let sumSquares = 0;
  let count = 0;
  // Sampling every fourth frame keeps continuous monitoring inexpensive on the JS thread.
  for (let index = 0; index < samples.length; index += 4) {
    const sample = samples[index] ?? 0;
    if (!Number.isFinite(sample)) continue;
    const clamped = Math.max(-1, Math.min(1, sample));
    sumSquares += clamped * clamped;
    count++;
  }
  if (!count) return MIN_DBFS;
  const rms = Math.sqrt(sumSquares / count);
  return Math.max(MIN_DBFS, Math.min(0, 20 * Math.log10(Math.max(rms, 0.00001))));
}

export function classifyDbfs(dbfs: number): NoiseBand {
  if (dbfs < -45) return 'quiet';
  if (dbfs < -25) return 'moderate';
  return 'loud';
}

export function dbfsToProgress(dbfs: number) {
  return Math.max(0, Math.min(1, (dbfs + 60) / 60));
}
