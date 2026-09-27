import { stopSpeaking } from './speak';

export type SpeechInputCapability = { available: boolean; mode: 'backend-recording' | 'manual-only'; reason?: string };

/**
 * Expo has text-to-speech but no built-in native speech recognizer. SENSEA keeps
 * input behind this adapter: a production adapter records a short clip with
 * expo-audio, POSTs it through transcribeAudio(), then deletes the local clip.
 * Until a provider is configured, callers must expose typed/manual controls.
 */
export async function prepareSpeechInput(): Promise<SpeechInputCapability> {
  await stopSpeaking(); // prevents the app from transcribing its own prompt
  return { available: false, mode: 'manual-only', reason: 'Speech transcription is not configured. Use typed input or accessible buttons.' };
}
