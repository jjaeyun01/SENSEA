import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { LargeActionButton } from '@/src/components/LargeActionButton';
import { colors } from '@/src/theme';
import { speak, stopSpeaking } from '@/src/voice/speak';

export default function HomeScreen() {
  const router = useRouter();
  const [destination, setDestination] = useState('');
  const [pendingDestination, setPendingDestination] = useState<string | null>(null);
  const [message, setMessage] = useState('목적지를 입력한 뒤 확인 버튼을 누르세요.');

  useEffect(() => {
    Vibration.vibrate(80);
    void speak('SENSEA가 실행되었습니다. 목적지를 입력해주세요.', false);
    return () => {
      void stopSpeaking();
    };
  }, []);

  const prepareConfirmation = () => {
    const name = destination.trim();
    if (!name) {
      const warning = '목적지를 입력해주세요.';
      setMessage(warning);
      void speak(warning);
      return;
    }

    setPendingDestination(name);
    const confirmation = `${name}으로 안내할까요? 목적지 이름이 맞으면 아래 확인 버튼을 누르세요.`;
    setMessage(confirmation);
    void speak(confirmation);
  };

  const confirmDestination = () => {
    if (!pendingDestination) return;
    Vibration.vibrate([0, 90, 80, 90]);
    AccessibilityInfo.announceForAccessibility(`목적지 확인됨: ${pendingDestination}`);
    router.push({ pathname: '/routes', params: { destination: pendingDestination } });
  };

  const changeDestination = () => {
    setPendingDestination(null);
    setMessage('목적지를 다시 입력해주세요.');
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <View style={styles.brandBlock}>
          <Text accessibilityRole="header" style={styles.title}>SENSEA</Text>
          <Text style={styles.subtitle}>시각장애인을 위한 캠퍼스 음성 길 안내</Text>
        </View>

        <View style={styles.panel}>
          <Text accessibilityRole="header" style={styles.prompt}>어디로 갈까요?</Text>
          <Text style={styles.help}>건물이나 캠퍼스 장소를 입력하세요.</Text>

          <TextInput
            accessibilityLabel="목적지"
            accessibilityHint="건물 또는 장소 이름을 입력합니다"
            autoCapitalize="none"
            autoCorrect={false}
            enterKeyHint="done"
            placeholder="예: 학생회관"
            placeholderTextColor="#65748B"
            value={destination}
            onChangeText={(value) => {
              setDestination(value);
              if (pendingDestination) setPendingDestination(null);
            }}
            onSubmitEditing={prepareConfirmation}
            returnKeyType="done"
            style={styles.input}
          />

          <View accessibilityLiveRegion="polite" style={styles.messageBox}>
            <Text style={styles.message}>{message}</Text>
          </View>

          {pendingDestination ? (
            <View style={styles.actions}>
              <LargeActionButton
                label={`${pendingDestination}, 맞습니다`}
                accessibilityHint="선택한 목적지의 경로를 불러옵니다"
                onPress={confirmDestination}
              />
              <LargeActionButton
                label="목적지 다시 입력"
                accessibilityHint="목적지 입력 단계로 돌아갑니다"
                onPress={changeDestination}
                variant="secondary"
              />
            </View>
          ) : (
            <LargeActionButton
              label="목적지 확인"
              accessibilityHint="입력한 목적지를 소리 내어 확인합니다"
              onPress={prepareConfirmation}
            />
          )}

          <LargeActionButton
            label="음성 입력, 준비 중"
            accessibilityHint="데모 기기에서 음성 인식 호환성을 확인한 뒤 제공됩니다"
            onPress={() => undefined}
            disabled
            variant="secondary"
          />
        </View>

        <Text accessibilityRole="text" style={styles.safety}>
          실험용 정보 보조 도구입니다. 이동 안전을 보장하거나 흰지팡이·안내견 등 이동 보조 수단을 대신하지 않습니다.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, padding: 24, paddingTop: 64, gap: 28 },
  brandBlock: { gap: 8 },
  title: { color: colors.text, fontSize: 42, fontWeight: '800', letterSpacing: 1 },
  subtitle: { color: colors.muted, fontSize: 18, lineHeight: 27 },
  panel: { backgroundColor: colors.surface, borderRadius: 20, padding: 20, gap: 18 },
  prompt: { color: colors.text, fontSize: 28, fontWeight: '700' },
  help: { color: colors.muted, fontSize: 18, lineHeight: 26 },
  input: {
    minHeight: 64,
    backgroundColor: colors.text,
    color: '#111827',
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    fontSize: 21,
    borderWidth: 3,
    borderColor: colors.primary,
  },
  messageBox: { minHeight: 54, justifyContent: 'center' },
  message: { color: colors.text, fontSize: 18, lineHeight: 27 },
  actions: { gap: 12 },
  safety: { color: colors.warning, fontSize: 16, lineHeight: 24 },
});

