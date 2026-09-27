export const GRID_DEGREES: number;
export function gridForLocation(latitude: number, longitude: number): { id: string; latitude: number; longitude: number };
export function relativeNoiseFromDbfs(dbfs: number): number;
export function summarizeDbfs(samples: number[]): { averageDbfs: number; peakDbfs: number; relativeNoise: number; sampleCount: number };
export function noiseLabel(relativeNoise: number): string;
