export type NoiseLevel = 'low' | 'medium' | 'high';

export type NoiseReading = {
  level: NoiseLevel;
  relativeValue: number;
  measuredAt: string;
};

/**
 * A phone microphone is not a calibrated decibel meter. This MVP intentionally
 * reports a relative level, not dB or crowd size. Add expo-audio recording
 * metering here only after calibration and explicit consent UX are ready.
 */
export async function measureRelativeNoise(): Promise<NoiseReading> {
  return {
    level: 'medium',
    relativeValue: 0.5,
    measuredAt: new Date().toISOString(),
  };
}

