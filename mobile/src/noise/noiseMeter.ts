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

/** Legacy one-shot permission helper retained for the deterministic route demo adapter. */
export async function requestNoisePermission(): Promise<{ granted: boolean; message: string }> {
  const permission = await AudioModule.requestRecordingPermissionsAsync();
  return permission.granted
    ? { granted: true, message: 'Microphone permission granted for a short, opt-in relative noise sample.' }
    : { granted: false, message: 'Microphone permission denied. No sample was collected; navigation remains available.' };
}

// Route fixtures continue to use deterministic values. The live, file-free PCM
// meter shown in the app is implemented separately by NoiseMonitorProvider.
export const noiseMeter: NoiseMeterAdapter = new DemoNoiseMeter();
