import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  Vibration,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { getVerifiedDemoDestination } from '@/src/api/client';
import { AppBackdrop } from '@/src/components/AppBackdrop';
import { LargeActionButton } from '@/src/components/LargeActionButton';
import { colors } from '@/src/theme';
import { speak, stopSpeaking } from '@/src/voice/speak';

export default function HomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 860;
  const destinationInput = useRef<TextInput>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [destination, setDestination] = useState('');
  const [pendingDestination, setPendingDestination] = useState<string | null>(null);
  const [message, setMessage] = useState('목적지를 입력한 뒤 확인 버튼을 누르세요.');

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
      Vibration.vibrate(80);
      void speak(
        '준비되었습니다. 화면 읽기 기능으로 목적지 입력, 목적지 확인, 음성 입력 안내 버튼을 탐색할 수 있습니다. 어디로 가시겠습니까?',
        false,
      );
    }, 1100);
    return () => {
      clearTimeout(timer);
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

    const verifiedDestination = getVerifiedDemoDestination(name);
    if (!verifiedDestination) {
      const warning = `${name}은 현재 검증된 데모 목적지가 아닙니다. Morgridge Hall, 학생회관, 도서관 또는 공학관을 입력해주세요.`;
      setPendingDestination(null);
      setMessage(warning);
      void speak(warning);
      return;
    }

    setPendingDestination(verifiedDestination);
    const confirmation = `${verifiedDestination}으로 안내할까요? 목적지 이름이 맞으면 아래 확인 버튼을 누르세요.`;
    setMessage(confirmation);
    void speak(confirmation);
  };

  const confirmDestination = () => {
    if (!pendingDestination) return;
    Vibration.vibrate([0, 90, 80, 90]);
    AccessibilityInfo.announceForAccessibility(`목적지 확인됨: ${pendingDestination}`);
    router.push({ pathname: '/destination', params: { destination: pendingDestination } });
  };

  const changeDestination = () => {
    setPendingDestination(null);
    setMessage('목적지를 다시 입력해주세요.');
    destinationInput.current?.focus();
  };

  const showVoiceInputHelp = () => {
    destinationInput.current?.focus();
    const help = '목적지 입력 칸을 열었습니다. 휴대폰 키보드의 마이크 받아쓰기 버튼으로 목적지를 말하거나 직접 입력하세요.';
    setMessage(help);
    void speak(help);
  };

  if (isLoading) {
    return (
      <View accessibilityLabel="SENSEA를 불러오는 중" style={styles.loadingScreen}>
        <AppBackdrop />
        <View style={styles.loadingMark}>
          <Text style={styles.loadingLetter}>S</Text>
        </View>
        <View style={styles.loadingTrack}><View style={styles.loadingProgress} /></View>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text accessibilityLiveRegion="polite" style={styles.loadingTitle}>Loading...</Text>
        <Text style={styles.loadingSubtitle}>Voice-first campus navigation</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <AppBackdrop />
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <View style={[styles.contentShell, isWide && styles.contentShellWide]}>
          <View style={[styles.hero, isWide && styles.heroWide]}>
            <View style={styles.brandRow}>
              <View style={styles.brandMark}><Text style={styles.brandLetter}>S</Text></View>
              <View style={styles.brandBlock}>
                <Text style={styles.ready}>SENSEA · READY</Text>
                <Text style={styles.brandCaption}>ACCESSIBLE CAMPUS MOBILITY</Text>
              </View>
            </View>

            <View style={styles.heroCopy}>
              <Text accessibilityRole="header" style={[styles.title, isWide && styles.titleWide]}>소리로 보고,{'\n'}안심하고 이동하세요.</Text>
              <Text style={styles.subtitle}>시각장애인을 위해 설계된 음성 우선 캠퍼스 내비게이션</Text>
            </View>

            <View style={styles.signalCard} accessible accessibilityLabel="위치, 음성, 카메라 보조 기능 준비됨">
              <View style={styles.signalBars} accessible={false}>
                <View style={[styles.signalBar, { height: 12 }]} />
                <View style={[styles.signalBar, { height: 20 }]} />
                <View style={[styles.signalBar, { height: 28 }]} />
                <View style={[styles.signalBar, { height: 36 }]} />
              </View>
              <View style={styles.signalCopy}>
                <Text style={styles.signalTitle}>Guidance system online</Text>
                <Text style={styles.signalText}>음성 · 햅틱 · 카메라 보조 준비 완료</Text>
              </View>
              <View style={styles.onlinePill}><View style={styles.onlineDot} /><Text style={styles.onlineText}>LIVE</Text></View>
            </View>

            <View style={styles.featureRow}>
              <View style={styles.featureCard}><Text style={styles.featureIcon}>◉</Text><Text style={styles.featureValue}>VOICE</Text><Text style={styles.featureLabel}>음성 우선</Text></View>
              <View style={styles.featureCard}><Text style={styles.featureIcon}>⌁</Text><Text style={styles.featureValue}>3 ROUTES</Text><Text style={styles.featureLabel}>맞춤 경로</Text></View>
              <View style={styles.featureCard}><Text style={styles.featureIcon}>◎</Text><Text style={styles.featureValue}>CAMERA</Text><Text style={styles.featureLabel}>요청형 보조</Text></View>
            </View>
          </View>

          <View style={[styles.panel, isWide && styles.panelWide]}>
            <View style={styles.panelHeader}>
              <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>01</Text></View>
              <View style={styles.panelHeaderCopy}>
                <Text style={styles.panelEyebrow}>SET DESTINATION</Text>
                <Text accessibilityRole="header" style={styles.prompt}>어디로 갈까요?</Text>
              </View>
            </View>
            <Text style={styles.help}>캠퍼스 건물이나 장소를 입력하면 확인 후 경로를 비교합니다.</Text>

            <View style={styles.screenReaderHelp}>
              <View style={styles.accessibilityIcon}><Text style={styles.accessibilityIconText}>A</Text></View>
              <Text style={styles.screenReaderHelpText}>
                VoiceOver 또는 TalkBack: 좌우 쓸기로 이동하고 두 번 탭해 선택하세요.
              </Text>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>DESTINATION</Text>
              <View style={styles.inputWrap}>
                <Text style={styles.searchIcon} accessible={false}>⌕</Text>
                <TextInput
                  ref={destinationInput}
                  accessibilityLabel="목적지"
                  accessibilityHint="건물 또는 장소 이름을 입력합니다"
                  autoCapitalize="none"
                  autoCorrect={false}
                  enterKeyHint="done"
                  placeholder="예: Morgridge Hall"
                  placeholderTextColor="#73869B"
                  value={destination}
                  onChangeText={(value) => {
                    setDestination(value);
                    if (pendingDestination) setPendingDestination(null);
                  }}
                  onSubmitEditing={prepareConfirmation}
                  returnKeyType="done"
                  style={styles.input}
                />
              </View>
            </View>

            <View accessibilityLiveRegion="polite" style={styles.messageBox}>
              <View style={styles.messageDot} />
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
              label="음성으로 목적지 입력"
              accessibilityHint="목적지 입력 칸을 열고 키보드 받아쓰기 사용법을 안내합니다"
              onPress={showVoiceInputHelp}
              variant="secondary"
            />
            <View style={styles.quickPlaces} accessible={false}>
              <Text style={styles.quickTitle}>DEMO LOCATIONS</Text>
              <Text style={styles.quickText}>Morgridge Hall · 학생회관 · 도서관 · 공학관</Text>
            </View>
          </View>
        </View>

        <View style={styles.safetyBar}>
          <Text style={styles.safetyIcon} accessible={false}>!</Text>
          <Text accessibilityRole="text" style={styles.safety}>실험용 정보 보조 도구입니다. 흰지팡이·안내견 등 이동 보조 수단을 대신하지 않습니다.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  loadingScreen: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24, overflow: 'hidden' },
  loadingMark: { width: 104, height: 104, borderRadius: 32, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: colors.primary, shadowOpacity: 0.34, shadowRadius: 28, elevation: 8 },
  loadingLetter: { color: colors.primaryText, fontSize: 54, fontWeight: '900' },
  loadingTrack: { width: 180, height: 4, borderRadius: 2, backgroundColor: colors.borderSoft, overflow: 'hidden' },
  loadingProgress: { width: '70%', height: '100%', backgroundColor: colors.primary },
  loadingTitle: { color: colors.text, fontSize: 32, fontWeight: '900' },
  loadingSubtitle: { color: colors.muted, fontSize: 17 },
  container: { flexGrow: 1, width: '100%', maxWidth: 1240, alignSelf: 'center', padding: 24, paddingTop: 54, gap: 24 },
  contentShell: { gap: 22 },
  contentShellWide: { flexDirection: 'row', alignItems: 'stretch', gap: 30 },
  hero: { gap: 26, paddingVertical: 10 },
  heroWide: { flex: 1.08, justifyContent: 'center', paddingRight: 18 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  brandMark: { width: 52, height: 52, borderRadius: 17, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  brandLetter: { color: colors.primaryText, fontSize: 29, fontWeight: '900' },
  brandBlock: { gap: 3 },
  ready: { color: colors.primary, fontSize: 13, fontWeight: '900', letterSpacing: 2.2 },
  brandCaption: { color: colors.subtle, fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  heroCopy: { gap: 15 },
  title: { color: colors.text, fontSize: 44, lineHeight: 53, fontWeight: '900', letterSpacing: -1 },
  titleWide: { fontSize: 56, lineHeight: 66 },
  subtitle: { color: colors.muted, fontSize: 19, lineHeight: 29, maxWidth: 590 },
  signalCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, backgroundColor: 'rgba(16,34,56,0.82)', borderWidth: 1, borderColor: colors.borderSoft },
  signalBars: { width: 46, height: 42, flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  signalBar: { width: 7, borderRadius: 4, backgroundColor: colors.primary },
  signalCopy: { flex: 1, gap: 3 },
  signalTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  signalText: { color: colors.muted, fontSize: 13 },
  onlinePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.primarySoft },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  onlineText: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  featureRow: { flexDirection: 'row', gap: 10 },
  featureCard: { flex: 1, minHeight: 98, padding: 13, borderRadius: 16, backgroundColor: 'rgba(12,25,43,0.8)', borderWidth: 1, borderColor: colors.borderSoft, gap: 4 },
  featureIcon: { color: colors.accent, fontSize: 20, fontWeight: '900' },
  featureValue: { color: colors.text, fontSize: 13, fontWeight: '900', letterSpacing: 0.8 },
  featureLabel: { color: colors.subtle, fontSize: 12 },
  panel: { backgroundColor: colors.surfaceGlass, borderRadius: 28, padding: 22, gap: 18, borderWidth: 1, borderColor: colors.border, shadowColor: '#000000', shadowOffset: { width: 0, height: 18 }, shadowOpacity: 0.3, shadowRadius: 28, elevation: 8 },
  panelWide: { flex: 0.92, padding: 28 },
  panelHeader: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepBadge: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.accent },
  stepBadgeText: { color: colors.accent, fontSize: 16, fontWeight: '900' },
  panelHeaderCopy: { flex: 1, gap: 3 },
  panelEyebrow: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1.8 },
  prompt: { color: colors.text, fontSize: 29, fontWeight: '800' },
  help: { color: colors.muted, fontSize: 18, lineHeight: 26 },
  screenReaderHelp: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(24,49,77,0.72)', borderRadius: 15, padding: 14, borderWidth: 1, borderColor: colors.borderSoft },
  accessibilityIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  accessibilityIconText: { color: colors.primaryText, fontWeight: '900' },
  screenReaderHelpText: { flex: 1, color: colors.muted, fontSize: 14, lineHeight: 21 },
  inputGroup: { gap: 8 },
  inputLabel: { color: colors.subtle, fontSize: 12, fontWeight: '900', letterSpacing: 1.6 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', minHeight: 68, backgroundColor: '#F8FBFF', borderRadius: 18, borderWidth: 2, borderColor: colors.primary, overflow: 'hidden' },
  searchIcon: { color: colors.accentSoft, fontSize: 28, paddingLeft: 17, fontWeight: '800' },
  input: {
    flex: 1,
    minHeight: 64,
    backgroundColor: 'transparent',
    color: '#111827',
    paddingHorizontal: 18,
    paddingVertical: 14,
    fontSize: 21,
  },
  messageBox: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  messageDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  message: { flex: 1, color: colors.text, fontSize: 16, lineHeight: 24 },
  actions: { gap: 12 },
  quickPlaces: { gap: 5, paddingTop: 2 },
  quickTitle: { color: colors.subtle, fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
  quickText: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  safetyBar: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, padding: 14, backgroundColor: 'rgba(74,52,16,0.72)', borderWidth: 1, borderColor: '#745D25' },
  safetyIcon: { width: 26, height: 26, borderRadius: 13, textAlign: 'center', lineHeight: 26, backgroundColor: colors.warning, color: '#4A3410', fontWeight: '900' },
  safety: { flex: 1, color: colors.warning, fontSize: 14, lineHeight: 21 },
});
