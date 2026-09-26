import { AccessibilityInfo } from 'react-native';
import * as Speech from 'expo-speech';

let lastMessage = '';

export async function speak(message: string, announce = true): Promise<void> {
  lastMessage = message;
  await Speech.stop();
  if (announce) AccessibilityInfo.announceForAccessibility(message);
  const screenReader = await AccessibilityInfo.isScreenReaderEnabled().catch(() => false);
  if (!screenReader) Speech.speak(message, { language: 'en-US', rate: 0.92 });
}

export async function repeatLast(): Promise<void> { if (lastMessage) await speak(lastMessage); }
export async function stopSpeaking(): Promise<void> { await Speech.stop(); }
export function getLastMessage(): string { return lastMessage; }
