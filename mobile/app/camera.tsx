import { useEffect, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { requestSceneDescription } from '@/src/api/client';
import { AppBackdrop } from '@/src/components/AppBackdrop';
import { LargeActionButton } from '@/src/components/LargeActionButton';
import { colors } from '@/src/theme';
import { speak, stopSpeaking } from '@/src/voice/speak';

function firstParam(value: string | string[] | undefined, fallback: string): string {
  return Array.isArray(value) ? (value[0] ?? fallback) : (value ?? fallback);
}

export default function CameraScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 900;
  const params = useLocalSearchParams<{
    destination?: string | string[];
    routeId?: string | string[];
    mode?: string | string[];
  }>();
  const destination = firstParam(params.destination, '목적지');
  const routeId = firstParam(params.routeId, 'flat-safe');
  const mode = firstParam(params.mode, 'describe');
  const isSetup = mode === 'setup';
  const [permission, requestPermission] = useCameraPermissions();
  const [description, setDescription] = useState(
    isSetup
      ? '휴대폰을 가슴 높이에서 정면을 향하도록 똑바로 들어주세요.'
      : '먼저 걸음을 멈추고 휴대폰을 가슴 높이에서 정면을 향하도록 들어주세요.',
  );
  const [isDescribing, setIsDescribing] = useState(false);

  useEffect(() => {
    const message = isSetup
      ? '카메라 설정 화면입니다. 휴대폰을 가슴 높이에서 정면을 향하도록 똑바로 들어주세요.'
      : '카메라 주변 확인 화면입니다. 먼저 걸음을 멈추세요. 휴대폰을 가슴 높이에서 정면을 향하도록 들어주세요.';
    void speak(message);
    return () => {
      void stopSpeaking();
    };
  }, [isSetup]);

  const describeScene = async () => {
    setIsDescribing(true);
    setDescription('주변 정보를 확인하고 있습니다.');
    const result = await requestSceneDescription();
    const announcement = `${result.isDemo ? '데모 결과입니다. ' : ''}${result.description} 불확실성은 ${result.uncertainty}입니다. 설명만으로 이동 안전을 판단하지 마세요.`;
    setDescription(announcement);
    setIsDescribing(false);
    void speak(announcement);
  };

  if (!permission) {
    return (
      <View style={styles.centered}>
        <AppBackdrop />
        <View style={styles.permissionIcon}><Text style={styles.permissionIconText}>◎</Text></View>
        <Text accessibilityLiveRegion="polite" style={styles.message}>카메라 권한 상태를 확인하고 있습니다.</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <AppBackdrop />
        <View style={styles.permissionIcon}><Text style={styles.permissionIconText}>◎</Text></View>
        <Text style={styles.eyebrow}>CAMERA PERMISSION</Text>
        <Text accessibilityRole="header" style={styles.title}>카메라 권한이 필요합니다</Text>
        <Text style={styles.message}>주변 설명을 요청할 때만 카메라를 사용합니다. 녹화하거나 백그라운드에서 실행하지 않습니다.</Text>
        <LargeActionButton
          label="카메라 권한 요청"
          accessibilityHint="기기의 카메라 권한 대화상자를 엽니다"
          onPress={() => void requestPermission()}
        />
      </View>
    );
  }

  return (
    <View style={[styles.root, isWide && styles.rootWide]}>
      <View style={[styles.cameraStage, isWide && styles.cameraStageWide]}>
        <CameraView accessibilityElementsHidden importantForAccessibility="no-hide-descendants" facing="back" style={styles.camera} />
        <View pointerEvents="none" accessible={false} style={styles.cameraOverlay}>
          <View style={styles.cameraTopBar}><View style={styles.cameraLive}><View style={styles.liveDot} /><Text style={styles.cameraLiveText}>CAMERA ACTIVE</Text></View><Text style={styles.cameraMode}>{isSetup ? 'ALIGNMENT' : 'ASSIST'}</Text></View>
          <View style={styles.focusFrame}><View style={[styles.corner, styles.topLeft]} /><View style={[styles.corner, styles.topRight]} /><View style={[styles.corner, styles.bottomLeft]} /><View style={[styles.corner, styles.bottomRight]} /><View style={styles.centerReticle} /></View>
          <Text style={styles.cameraInstruction}>가슴 높이 · 정면 유지</Text>
        </View>
      </View>
      <View style={[styles.controls, isWide && styles.controlsWide]}>
        <View style={styles.stepPill}><Text style={styles.stepPillText}>{isSetup ? 'STEP 04 · SETUP' : 'ON-DEMAND ASSIST'}</Text></View>
        <Text style={styles.eyebrow}>{isSetup ? 'CAMERA SETUP' : 'SCENE DESCRIPTION'}</Text>
        <Text accessibilityRole="header" style={styles.title}>{isSetup ? '카메라 방향을 맞춰주세요.' : '주변을 음성으로 설명합니다.'}</Text>
        <Text accessibilityLiveRegion="assertive" style={styles.description}>{description}</Text>
        <View style={styles.privacyCard}><View style={styles.privacyIcon}><Text style={styles.privacyIconText}>✓</Text></View><View style={styles.privacyCopy}><Text style={styles.privacyTitle}>Privacy first</Text><Text style={styles.privacyText}>영상은 녹화하거나 서버에 저장하지 않습니다.</Text></View></View>
        {isSetup ? (
          <LargeActionButton
            label="카메라 위치 확인 완료"
            accessibilityHint="360도 공간 정렬 단계로 이동합니다"
            onPress={() => router.replace({ pathname: '/scan', params: { destination, routeId } })}
          />
        ) : (
          <LargeActionButton
            label="현재 장면 설명하기"
            accessibilityHint="멈춘 상태에서 현재 장면의 랜드마크 설명과 불확실성을 음성으로 들려줍니다"
            onPress={() => void describeScene()}
            loading={isDescribing}
          />
        )}
        <Text style={styles.safety}>{isSetup ? '카메라는 공간 정렬 데모에만 사용되며 녹화하거나 저장하지 않습니다.' : '현재 버전은 카메라 프레임을 분석하지 않는 데모입니다. 반드시 걸음을 멈춘 상태에서 사용하고, 설명만으로 장애물 회피나 횡단 여부를 판단하지 마세요.'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  rootWide: { flexDirection: 'row' },
  centered: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 20, overflow: 'hidden' },
  permissionIcon: { width: 78, height: 78, borderRadius: 26, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  permissionIconText: { color: colors.primary, fontSize: 42, fontWeight: '900' },
  cameraStage: { flex: 1, minHeight: 300, backgroundColor: '#02070C' },
  cameraStageWide: { flex: 1.25 },
  camera: { position: 'absolute', inset: 0 },
  cameraOverlay: { position: 'absolute', inset: 0, padding: 22, justifyContent: 'space-between' },
  cameraTopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cameraLive: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, backgroundColor: 'rgba(7,17,31,0.78)' },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  cameraLiveText: { color: colors.text, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  cameraMode: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1.4, backgroundColor: 'rgba(7,17,31,0.78)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7 },
  focusFrame: { flex: 1, margin: 30 },
  corner: { position: 'absolute', width: 44, height: 44, borderColor: colors.primary },
  topLeft: { left: 0, top: 0, borderLeftWidth: 4, borderTopWidth: 4 },
  topRight: { right: 0, top: 0, borderRightWidth: 4, borderTopWidth: 4 },
  bottomLeft: { left: 0, bottom: 0, borderLeftWidth: 4, borderBottomWidth: 4 },
  bottomRight: { right: 0, bottom: 0, borderRightWidth: 4, borderBottomWidth: 4 },
  centerReticle: { position: 'absolute', width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.primary, left: '50%', top: '50%', marginLeft: -11, marginTop: -11 },
  cameraInstruction: { alignSelf: 'center', color: colors.text, fontSize: 13, fontWeight: '800', backgroundColor: 'rgba(7,17,31,0.8)', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8 },
  controls: { backgroundColor: colors.background, padding: 24, gap: 16 },
  controlsWide: { flex: 0.75, justifyContent: 'center', padding: 36 },
  stepPill: { alignSelf: 'flex-start', backgroundColor: colors.accentSoft, borderRadius: 18, paddingHorizontal: 11, paddingVertical: 7 },
  stepPillText: { color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  eyebrow: { color: colors.primary, fontSize: 13, fontWeight: '900', letterSpacing: 2 },
  title: { color: colors.text, fontSize: 27, fontWeight: '800' },
  message: { color: colors.text, fontSize: 19, lineHeight: 29 },
  description: { color: colors.text, fontSize: 20, lineHeight: 30, minHeight: 60 },
  privacyCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft },
  privacyIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  privacyIconText: { color: colors.primary, fontWeight: '900' },
  privacyCopy: { flex: 1, gap: 2 },
  privacyTitle: { color: colors.text, fontSize: 14, fontWeight: '900' },
  privacyText: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  safety: { color: colors.warning, fontSize: 15, lineHeight: 23 },
});
