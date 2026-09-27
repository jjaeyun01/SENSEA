export const GRID_DEGREES = 0.0004;

export function gridForLocation(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error('Invalid location');
  }
  const latIndex = Math.floor(latitude / GRID_DEGREES);
  const lonIndex = Math.floor(longitude / GRID_DEGREES);
  return {
    id: `${latIndex}:${lonIndex}`,
    latitude: Number(((latIndex + 0.5) * GRID_DEGREES).toFixed(6)),
    longitude: Number(((lonIndex + 0.5) * GRID_DEGREES).toFixed(6)),
  };
}

export function relativeNoiseFromDbfs(dbfs) {
  if (!Number.isFinite(dbfs)) throw new Error('Invalid dBFS value');
  // Provisional relative scale. This is deliberately not labeled dBA/SPL.
  return Math.max(0, Math.min(1, (dbfs + 80) / 70));
}

export function summarizeDbfs(samples) {
  const valid = samples.filter(value => Number.isFinite(value) && value >= -160 && value <= 0);
  if (valid.length < 3) throw new Error('Not enough valid microphone samples');
  // Average in the linear power domain, then return to dBFS.
  const meanPower = valid.reduce((sum, value) => sum + 10 ** (value / 10), 0) / valid.length;
  const averageDbfs = Math.max(-160, Math.min(0, 10 * Math.log10(meanPower)));
  return {
    averageDbfs: Number(averageDbfs.toFixed(2)),
    peakDbfs: Number(Math.max(...valid).toFixed(2)),
    relativeNoise: Number(relativeNoiseFromDbfs(averageDbfs).toFixed(4)),
    sampleCount: valid.length,
  };
}

export function noiseLabel(relativeNoise) {
  if (relativeNoise < 0.2) return 'Very quiet';
  if (relativeNoise < 0.4) return 'Quiet';
  if (relativeNoise < 0.65) return 'Moderate';
  if (relativeNoise < 0.85) return 'Loud';
  return 'Very loud';
}
