import { AccessibilityInfo } from 'react-native';
import * as Speech from 'expo-speech';

export async function speak(message: string, interrupt = true): Promise<void> {
  if (interrupt) {
    await Speech.stop();
  }

  const screenReaderEnabled = await AccessibilityInfo.isScreenReaderEnabled().catch(() => false);
  if (screenReaderEnabled) {
    AccessibilityInfo.announceForAccessibility(message);
    return;
  }

  Speech.speak(message, {
    language: 'ko-KR',
    rate: 0.92,
    pitch: 1,
  });
}

export async function stopSpeaking(): Promise<void> {
  await Speech.stop();
}

