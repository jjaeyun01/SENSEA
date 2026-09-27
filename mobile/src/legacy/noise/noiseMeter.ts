/** Relative device dBFS index, NOT calibrated dB SPL or a crowd estimate.
 * Feed only explicit-consent, short-duration metering samples from one device.
 * Same normalization must be used across the demo devices.
 */
export function summarizeMetering(samplesDbfs: number[]): { relative_noise: number; sample_count: number } {
  if (!samplesDbfs.length || samplesDbfs.some(value => !Number.isFinite(value) || value > 0 || value < -160)) {
    throw new Error('Valid dBFS metering samples are required.');
  }
  const meanPower = samplesDbfs.reduce((sum, db) => sum + 10 ** (db / 10), 0) / samplesDbfs.length;
  const dbfs = 10 * Math.log10(meanPower);
  return { relative_noise: Math.max(0, Math.min(1, (dbfs + 60) / 60)), sample_count: samplesDbfs.length };
}
