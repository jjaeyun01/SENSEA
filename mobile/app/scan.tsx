import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, useWindowDimensions, Vibration, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { LargeActionButton } from '@/src/components/LargeActionButton';
import { AppBackdrop } from '@/src/components/AppBackdrop';
import { colors } from '@/src/theme';
import { speak } from '@/src/voice/speak';

function firstParam(value: string | string[] | undefined, fallback: string): string {
  return Array.isArray(value) ? (value[0] ?? fallback) : (value ?? fallback);
}

export default function ScanScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 820;
  const params = useLocalSearchParams<{
    destination?: string | string[];
    routeId?: string | string[];
  }>();
  const destination = firstParam(params.destination, '목적지');
  const routeId = firstParam(params.routeId, 'flat-safe');
  const rotation = useRef(new Animated.Value(0)).current;
  const completed = useRef(false);

  const finishScan = () => {
    if (completed.current) return;
    completed.current = true;
    Vibration.vibrate([0, 90, 70, 90]);
    void speak('공간 정렬 데모가 완료되었습니다. 음성 안내 화면으로 이동합니다.');
    router.replace({ pathname: '/navigate', params: { destination, routeId } });
  };

  useEffect(() => {
    void speak('360도 공간 정렬 데모를 시작합니다. 휴대폰을 정면으로 유지하세요.');
    const animation = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 1700,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    const timer = setTimeout(finishScan, 3200);

    return () => {
      clearTimeout(timer);
      animation.stop();
    };
  }, []);

  const rotate = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={styles.root}>
      <AppBackdrop />
      <View style={[styles.shell, isWide && styles.shellWide]}>
        <View style={styles.scanPanel}>
          <View style={styles.scanPanelHeader}><Text style={styles.panelLabel}>LIVE ORIENTATION</Text><View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>SCANNING</Text></View></View>
          <View accessible accessibilityLabel="360도 공간 정렬 진행 중" style={styles.scanArea}>
            <View style={styles.outerRing} />
            <View style={styles.ring} />
            <View style={styles.innerRing} />
            <View style={[styles.axis, styles.axisHorizontal]} />
            <View style={[styles.axis, styles.axisVertical]} />
            <Animated.View style={[styles.sweep, { transform: [{ rotate }] }]}>
              <View style={styles.sweepLine} />
              <View style={styles.sweepTip} />
            </Animated.View>
            <View style={styles.centerDot} />
            <Text style={styles.degree}>360°</Text>
            <Text style={styles.north}>N</Text>
            <Text style={styles.east}>E</Text>
            <Text style={styles.south}>S</Text>
            <Text style={styles.west}>W</Text>
          </View>
          <View style={styles.sensorRow} accessible={false}>
            <View style={styles.sensorItem}><Text style={styles.sensorValue}>12</Text><Text style={styles.sensorLabel}>FEATURES</Text></View>
            <View style={styles.sensorDivider} />
            <View style={styles.sensorItem}><Text style={styles.sensorValue}>± 3m</Text><Text style={styles.sensorLabel}>EST. ACCURACY</Text></View>
            <View style={styles.sensorDivider} />
            <View style={styles.sensorItem}><Text style={styles.sensorValue}>74%</Text><Text style={styles.sensorLabel}>ALIGNMENT</Text></View>
          </View>
        </View>

        <View style={styles.copyPanel}>
          <View style={styles.stepPill}><Text style={styles.stepPillText}>STEP 04 · CAMERA GROUNDING</Text></View>
          <Text style={styles.eyebrow}>SPATIAL ALIGNMENT</Text>
          <Text accessibilityRole="header" style={styles.title}>주변 공간을{isWide ? '\n' : ' '}맞추고 있어요.</Text>
          <Text accessibilityLiveRegion="polite" style={styles.description}>캠퍼스 랜드마크와 카메라 방향을 일치시키는 시뮬레이션입니다.</Text>
          <View style={styles.instructionCard}>
            <View style={styles.phoneGlyph}><Text style={styles.phoneGlyphText}>▯</Text></View>
            <View style={styles.instructionCopy}><Text style={styles.instructionTitle}>휴대폰을 정면으로 유지하세요</Text><Text style={styles.instructionText}>가슴 높이에서 기울이지 않고 잠시 기다려주세요.</Text></View>
          </View>
          <LargeActionButton label="정렬 완료하고 안내 시작" accessibilityHint="자동 완료를 기다리지 않고 음성 안내 화면으로 이동합니다" onPress={finishScan} variant="secondary" />
          <View style={styles.noticeCard}><Text style={styles.noticeIcon}>i</Text><Text style={styles.notice}>실제 VPS 위치 보정이 아닌 해커톤 시뮬레이션입니다.</Text></View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, padding: 24, justifyContent: 'center', overflow: 'hidden' },
  shell: { width: '100%', maxWidth: 1080, alignSelf: 'center', gap: 22 },
  shellWide: { flexDirection: 'row', alignItems: 'center' },
  scanPanel: { flex: 1.08, padding: 20, borderRadius: 28, backgroundColor: colors.surfaceGlass, borderWidth: 1, borderColor: colors.border, gap: 10, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 28, elevation: 8 },
  scanPanelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  panelLabel: { color: colors.subtle, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  livePill: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, backgroundColor: colors.primarySoft },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  liveText: { color: colors.primary, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  copyPanel: { flex: 0.92, gap: 18, padding: 8 },
  stepPill: { alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.accentSoft },
  stepPillText: { color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  eyebrow: { color: colors.primary, fontSize: 13, fontWeight: '900', letterSpacing: 2 },
  title: { color: colors.text, fontSize: 40, lineHeight: 48, fontWeight: '900' },
  description: { color: colors.muted, fontSize: 18, lineHeight: 27 },
  scanArea: { width: 320, height: 320, maxWidth: '100%', alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginVertical: 8 },
  outerRing: { position: 'absolute', width: 294, height: 294, borderRadius: 147, borderWidth: 1, borderColor: colors.border },
  ring: { position: 'absolute', width: 250, height: 250, borderRadius: 125, borderWidth: 3, borderColor: colors.primary },
  innerRing: { position: 'absolute', width: 164, height: 164, borderRadius: 82, borderWidth: 1, borderColor: colors.accentSoft },
  axis: { position: 'absolute', backgroundColor: colors.borderSoft },
  axisHorizontal: { width: 280, height: 1 },
  axisVertical: { width: 1, height: 280 },
  sweep: { position: 'absolute', width: 250, height: 250, alignItems: 'center' },
  sweepLine: { width: 4, height: 116, borderRadius: 3, backgroundColor: colors.warning },
  sweepTip: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.warning, marginTop: -4, shadowColor: colors.warning, shadowOpacity: 0.8, shadowRadius: 10 },
  centerDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primary, borderWidth: 5, borderColor: colors.primarySoft },
  degree: { position: 'absolute', color: colors.text, fontSize: 38, fontWeight: '900' },
  north: { position: 'absolute', top: 3, color: colors.primary, fontSize: 13, fontWeight: '900' },
  east: { position: 'absolute', right: 5, color: colors.subtle, fontSize: 13, fontWeight: '900' },
  south: { position: 'absolute', bottom: 3, color: colors.subtle, fontSize: 13, fontWeight: '900' },
  west: { position: 'absolute', left: 3, color: colors.subtle, fontSize: 13, fontWeight: '900' },
  sensorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderRadius: 16, backgroundColor: colors.backgroundSoft },
  sensorItem: { flex: 1, alignItems: 'center', gap: 3 },
  sensorValue: { color: colors.text, fontSize: 16, fontWeight: '900' },
  sensorLabel: { color: colors.subtle, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  sensorDivider: { width: 1, height: 30, backgroundColor: colors.borderSoft },
  instructionCard: { flexDirection: 'row', gap: 14, alignItems: 'center', padding: 16, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSoft },
  phoneGlyph: { width: 48, height: 58, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  phoneGlyphText: { color: colors.accent, fontSize: 34, fontWeight: '900' },
  instructionCopy: { flex: 1, gap: 4 },
  instructionTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  instructionText: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  noticeCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: 'rgba(74,52,16,0.7)' },
  noticeIcon: { width: 23, height: 23, borderRadius: 12, textAlign: 'center', lineHeight: 23, backgroundColor: colors.warning, color: '#4A3410', fontWeight: '900' },
  notice: { flex: 1, color: colors.warning, fontSize: 13, lineHeight: 19 },
});
