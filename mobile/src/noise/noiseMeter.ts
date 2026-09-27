import { AudioModule } from 'expo-audio';

export type NoiseReading = { relativeNoise: number; measuredAt: string; mode: 'demo-deterministic' | 'device-meter'; rawAudioStored: false };
export interface NoiseMeterAdapter { measure(edgeId: string): Promise<NoiseReading>; }

/** Deterministic demo adapter. It never claims to be a live microphone reading. */
export class DemoNoiseMeter implements NoiseMeterAdapter {
  async measure(edgeId: string): Promise<NoiseReading> {
    const values: Record<string, number> = { edge_start_quad: 0.82, edge_quad_arcade: 0.76, edge_start_garden: 0.18, edge_garden_arcade: 0.22 };
    return { relativeNoise: values[edgeId] ?? 0.5, measuredAt: new Date().toISOString(), mode: 'demo-deterministic', rawAudioStored: false };
  }
}

/** Permission is requested only from an explicit measurement action. */
export async function requestNoisePermission(): Promise<{ granted: boolean; message: string }> {
  const permission = await AudioModule.requestRecordingPermissionsAsync();
  return permission.granted
    ? { granted: true, message: 'Microphone permission granted for a short, opt-in relative noise sample.' }
    : { granted: false, message: 'Microphone permission denied. No sample was collected; navigation remains available.' };
}

// A calibrated/device-tested implementation should calculate a normalized RMS
// summary, discard the recording, and return only 0..1. The MVP selects the
// labelled DemoNoiseMeter until that adapter is validated on the demo phone.
export const noiseMeter: NoiseMeterAdapter = new DemoNoiseMeter();
