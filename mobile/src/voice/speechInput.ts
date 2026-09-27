export type SpeechInputCapability = {
  available: boolean;
  reason?: string;
};

/**
 * expo-speech provides text-to-speech, not speech recognition.
 * Keep STT behind this adapter so a tested native module can be added without
 * changing the accessible screens.
 */
export async function getSpeechInputCapability(): Promise<SpeechInputCapability> {
  return {
    available: false,
    reason: '음성 인식 모듈은 데모 기기에서 호환성을 확인한 뒤 활성화됩니다.',
  };
}

