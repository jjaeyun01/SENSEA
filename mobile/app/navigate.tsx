import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  Vibration,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { requestRoutes, type NavigationStep, type RouteOption } from '@/src/api/client';
import { LargeActionButton } from '@/src/components/LargeActionButton';
import { CampusMapPreview } from '@/src/components/CampusMapPreview';
import { AppBackdrop } from '@/src/components/AppBackdrop';
import { GuidanceQueue, type GuidanceMessage } from '@/src/navigation/guidanceQueue';
import { getCurrentLocation } from '@/src/navigation/location';
import { colors } from '@/src/theme';
import { speak } from '@/src/voice/speak';

function firstParam(value: string | string[] | undefined, fallback: string): string {
  return Array.isArray(value) ? (value[0] ?? fallback) : (value ?? fallback);
}

function vibrateForPriority(priority: GuidanceMessage['priority']) {
  if (priority === 0) Vibration.vibrate([0, 450, 100, 450]);
  else if (priority === 1) Vibration.vibrate([0, 250, 100, 250]);
  else if (priority === 2) Vibration.vibrate([0, 120, 80, 120]);
  else Vibration.vibrate(70);
}

export default function NavigateScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 920;
  const params = useLocalSearchParams<{
    destination?: string | string[];
    routeId?: string | string[];
  }>();
  const destination = firstParam(params.destination, '목적지');
  const routeId = firstParam(params.routeId, 'flat-safe');
  const queue = useRef(new GuidanceQueue());
  const [route, setRoute] = useState<RouteOption | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [navigationStarted, setNavigationStarted] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [locationMode, setLocationMode] = useState<'checking' | 'live' | 'manual'>('checking');
  const [locationStatus, setLocationStatus] = useState('위치를 확인하고 있습니다.');
  const [lastMessage, setLastMessage] = useState('안내를 준비하고 있습니다.');

  const issueGuidance = (message: GuidanceMessage) => {
    queue.current.enqueue(message);
    const next = queue.current.next();
    if (!next) return;
    vibrateForPriority(next.priority);
    setLastMessage(next.text);
    void speak(next.text);
  };

  useEffect(() => {
    let cancelled = false;
    void requestRoutes(destination).then(({ routes }) => {
      if (cancelled) return;
      const selected = routes.find((candidate) => candidate.id === routeId) ?? routes[0];
      if (!selected) {
        setLastMessage('선택한 경로를 찾을 수 없습니다. 이전 화면에서 다시 선택해주세요.');
        return;
      }
      setRoute(selected);
      const startMessage = `${selected.name}을 준비했습니다. 위치 확인이 끝나면 안내 시작 버튼을 누르세요.`;
      setLastMessage(startMessage);
      void speak(startMessage);
    });

    void getCurrentLocation().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLocationStatus(result.reason);
        setLocationMode('manual');
        void speak(`${result.reason} 현재 위치를 직접 확인한 후 시뮬레이션 안내를 시작할 수 있습니다.`);
        return;
      }
      const accuracy = result.accuracyMeters;
      if (accuracy !== null && accuracy > 30) {
        const warning = `현재 위치 오차가 약 ${Math.round(accuracy)}미터로 큽니다. 정확한 회전 방향을 제공하지 않습니다. 현재 위치를 직접 확인한 후 시뮬레이션을 시작하세요.`;
        setLocationStatus(warning);
        setLocationMode('manual');
        void speak(warning);
      } else {
        setLocationStatus('현재 위치를 확인했습니다. 안내를 시작할 수 있습니다.');
        setLocationMode('live');
      }
    });

    return () => {
      cancelled = true;
      queue.current.clear();
      Vibration.cancel();
    };
  }, [destination, routeId]);

  const currentStep: NavigationStep | undefined = route?.steps[stepIndex];
  const remainingMeters = route
    ? route.steps
        .slice(stepIndex)
        .reduce((total, step) => total + step.distanceMeters, 0)
    : 0;

  const instructionForCurrentAccuracy = (step: NavigationStep): string => {
    if (locationMode !== 'manual') return step.instruction;
    const isFinalStep = route ? step.id === route.steps[route.steps.length - 1]?.id : false;
    if (isFinalStep) {
      return `${destination} 근처의 마지막 검증 지점입니다. 위치 정확도가 낮으므로 정확한 출입구는 직접 확인하세요.`;
    }
    return '위치 정확도가 낮아 정확한 회전 방향은 생략합니다. 다음 검증된 경유지를 수동으로 확인한 뒤 다음 안내 버튼을 누르세요.';
  };

  const startNavigation = () => {
    if (!currentStep || locationMode === 'checking' || stopped) return;
    setNavigationStarted(true);
    const prefix = locationMode === 'manual'
      ? '수동 위치 확인을 선택했습니다. 시뮬레이션 안내를 시작합니다. '
      : '안내를 시작합니다. ';
    issueGuidance({
      id: `start-${currentStep.id}-${Date.now()}`,
      priority: currentStep.priority,
      text: `${prefix}${instructionForCurrentAccuracy(currentStep)}`,
    });
  };

  const repeatInstruction = () => {
    if (!currentStep || !navigationStarted) {
      void speak(lastMessage);
      return;
    }
    issueGuidance({
      id: `repeat-${currentStep.id}-${Date.now()}`,
      priority: currentStep.priority,
      text: instructionForCurrentAccuracy(currentStep),
    });
  };

  const advanceStep = () => {
    if (!route || !currentStep || paused || stopped || !navigationStarted) return;
    if (stepIndex >= route.steps.length - 1) {
      const arrivalMessage = `${destination} 근처에 도착했습니다. 정확한 출입구와 주변 안전을 직접 확인하세요.`;
      setArrived(true);
      issueGuidance({ id: `arrival-${Date.now()}`, priority: 2, text: arrivalMessage });
      return;
    }

    const nextIndex = stepIndex + 1;
    const nextStep = route.steps[nextIndex];
    if (!nextStep) return;
    setStepIndex(nextIndex);
    issueGuidance({ id: nextStep.id, priority: nextStep.priority, text: instructionForCurrentAccuracy(nextStep) });
  };

  const togglePause = () => {
    if (!navigationStarted || stopped) return;
    const nextPaused = !paused;
    setPaused(nextPaused);
    const message = nextPaused ? '안내를 일시 정지했습니다.' : '안내를 다시 시작합니다.';
    issueGuidance({ id: `pause-${Date.now()}`, priority: 2, text: message });
  };

  const simulateUrgentHazard = () => {
    if (!navigationStarted || stopped) return;
    issueGuidance({
      id: `hazard-${Date.now()}`,
      priority: 0,
      text: '긴급 위험 알림 데모입니다. 전방 장애물 가능성이 있습니다. 즉시 멈추고 주변을 확인하세요.',
    });
  };

  const stopNavigation = () => {
    if (stopped) return;
    queue.current.clear();
    Vibration.cancel();
    setPaused(true);
    setStopped(true);
    const message = '내비게이션을 종료했습니다. 더 이상 경로 안내를 제공하지 않습니다.';
    setLastMessage(message);
    void speak(message);
  };

  if (!route) {
    return (
      <View accessibilityLabel="안내를 준비하는 중" style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>{lastMessage}</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <AppBackdrop />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.navigationHeader}>
          <View style={styles.headerCopy}>
            <View style={styles.liveRow}><View style={styles.liveDot} /><Text style={styles.liveLabel}>GUIDANCE READY</Text></View>
            <Text accessibilityRole="header" style={styles.title}>{destination}</Text>
            <Text style={styles.routeName}>{route.name} · 약 {route.durationMinutes}분 · {route.distanceMeters}m</Text>
          </View>
          <View style={styles.distanceSummary} accessible accessibilityLabel={`목적지까지 남은 거리 ${remainingMeters}미터`}>
            <Text style={styles.distanceValue}>{remainingMeters}</Text><Text style={styles.distanceUnit}>m LEFT</Text>
          </View>
        </View>

        <View style={styles.progressTrack} accessible={false}><View style={[styles.progressFill, { width: `${Math.max(8, ((stepIndex + 1) / route.steps.length) * 100)}%` }]} /></View>

        <View accessibilityRole="alert" style={styles.prototypeBanner}>
          <Text style={styles.prototypeBadge}>DEMO</Text><Text style={styles.prototypeText}>모의 안내입니다. 실시간 장애물 감지나 안전한 횡단을 보장하지 않습니다.</Text>
        </View>

        <View style={[styles.dashboard, isWide && styles.dashboardWide]}>
          <View style={styles.visualColumn}>
            <View style={styles.cameraAssistCard}>
              <View style={styles.cameraTopRow}>
                <View style={styles.cameraIcon} accessible={false}><Text style={styles.cameraIconText}>◎</Text></View>
                <View style={styles.cameraCopy}><Text style={styles.cameraLabel}>CAMERA ASSIST</Text><Text style={styles.cameraText}>걸음을 멈춘 뒤 필요할 때만 주변 설명을 요청하세요.</Text></View>
              </View>
              <View style={styles.cameraPreview} accessible={false}>
                <View style={[styles.frameCorner, styles.cornerTopLeft]} /><View style={[styles.frameCorner, styles.cornerTopRight]} /><View style={[styles.frameCorner, styles.cornerBottomLeft]} /><View style={[styles.frameCorner, styles.cornerBottomRight]} />
                <View style={styles.horizonLine} /><Text style={styles.previewText}>USER-TRIGGERED VIEW</Text>
              </View>
              <LargeActionButton label="카메라 열기" accessibilityHint="사용자가 요청할 때만 카메라를 열어 주변 설명을 확인합니다" onPress={() => router.push({ pathname: '/camera', params: { destination, routeId, mode: 'describe' } })} variant="secondary" disabled={stopped} />
            </View>

            <View style={styles.mapCard}>
              <View style={styles.sectionHeader}><Text style={styles.sectionEyebrow}>ROUTE OVERVIEW</Text><Text style={styles.mapDistance}>{remainingMeters}m remaining</Text></View>
              <CampusMapPreview destination={destination} compact remainingMeters={remainingMeters} />
            </View>
          </View>

          <View style={styles.guideColumn}>
            <View style={styles.statusCard}>
              <View style={styles.statusTopRow}><View><Text style={styles.statusLabel}>CURRENT GUIDANCE</Text><Text style={styles.progress}>경유지 {Math.min(stepIndex + 1, route.steps.length)} / {route.steps.length}</Text></View><View style={styles.speakerGlyph}><Text style={styles.speakerGlyphText}>)))</Text></View></View>
              <Text accessibilityLiveRegion="assertive" style={styles.instruction}>{lastMessage}</Text>
            </View>

            <View style={styles.locationCard}>
              <View style={styles.locationIcon}><Text style={styles.locationIconText}>⌖</Text></View>
              <View style={styles.locationCopy}><Text style={styles.locationLabel}>LOCATION STATUS</Text><Text accessibilityLiveRegion="polite" style={styles.locationText}>{locationStatus}</Text></View>
            </View>

            <View style={styles.actions}>
              <LargeActionButton
                label={stopped ? '안내 종료됨' : !navigationStarted ? locationMode === 'checking' ? 'GPS 확인 중' : locationMode === 'manual' ? '수동 확인 후 시뮬레이션 시작' : '안내 시작' : arrived ? '안내 완료' : paused ? '일시 정지 중' : '다음 경유지 안내'}
                accessibilityHint={navigationStarted ? '다음 경유지로 진행합니다' : '현재 위치 확인 결과에 따라 안내를 시작합니다'}
                onPress={navigationStarted ? advanceStep : startNavigation}
                disabled={locationMode === 'checking' || paused || arrived || stopped}
              />
              <View style={styles.secondaryActions}>
                <View style={styles.actionHalf}><LargeActionButton label="다시 듣기" onPress={repeatInstruction} variant="secondary" /></View>
                <View style={styles.actionHalf}><LargeActionButton label={paused ? '계속하기' : '일시 정지'} onPress={togglePause} variant="secondary" disabled={!navigationStarted || stopped} /></View>
              </View>
              <LargeActionButton label="P0 긴급 알림 시험" accessibilityHint="우선순위 큐의 긴급 경고 진동과 음성을 시험합니다" onPress={simulateUrgentHazard} variant="danger" disabled={!navigationStarted || stopped} />
              {!stopped ? <LargeActionButton label="내비게이션 종료" accessibilityHint="모든 경로 안내와 진동을 중단합니다" onPress={stopNavigation} variant="danger" /> : <LargeActionButton label="처음 화면으로 돌아가기" onPress={() => router.replace('/')} variant="secondary" />}
            </View>
          </View>
        </View>

        <View style={styles.footnoteCard}><Text style={styles.footnoteIcon}>!</Text><Text style={styles.footnote}>긴급 알림 버튼은 우선순위 큐 동작을 보여주기 위한 데모이며 실제 장애물을 감지하지 않습니다.</Text></View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { width: '100%', maxWidth: 1220, alignSelf: 'center', padding: 24, gap: 18, paddingBottom: 56 },
  loading: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  loadingText: { color: colors.text, fontSize: 18, textAlign: 'center' },
  navigationHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  headerCopy: { flex: 1, gap: 5 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  liveLabel: { color: colors.primary, fontSize: 11, fontWeight: '900', letterSpacing: 1.6 },
  title: { color: colors.text, fontSize: 36, fontWeight: '900' },
  routeName: { color: colors.primary, fontSize: 19, fontWeight: '700' },
  distanceSummary: { minWidth: 100, alignItems: 'flex-end' },
  distanceValue: { color: colors.text, fontSize: 34, lineHeight: 38, fontWeight: '900' },
  distanceUnit: { color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.borderSoft, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: colors.primary },
  prototypeBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(74,52,16,0.72)', borderColor: '#745D25', borderWidth: 1, borderRadius: 15, padding: 13 },
  prototypeBadge: { color: '#4A3410', backgroundColor: colors.warning, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 4, fontSize: 10, fontWeight: '900' },
  prototypeText: { flex: 1, color: colors.warning, fontSize: 14, lineHeight: 21 },
  dashboard: { gap: 18 },
  dashboardWide: { flexDirection: 'row', alignItems: 'flex-start' },
  visualColumn: { flex: 1.05, gap: 18 },
  guideColumn: { flex: 0.95, gap: 18 },
  cameraAssistCard: { backgroundColor: colors.surfaceGlass, borderRadius: 24, padding: 18, gap: 14, borderWidth: 1, borderColor: colors.border },
  cameraTopRow: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  cameraIcon: { width: 64, height: 48, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  cameraIconText: { color: colors.primaryText, fontSize: 32, fontWeight: '900' },
  cameraCopy: { gap: 4 },
  cameraLabel: { color: colors.primary, fontSize: 14, fontWeight: '900', letterSpacing: 1.5 },
  cameraText: { color: colors.text, fontSize: 17, lineHeight: 25 },
  cameraPreview: { height: 138, borderRadius: 18, backgroundColor: '#07101B', borderWidth: 1, borderColor: colors.borderSoft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  frameCorner: { position: 'absolute', width: 28, height: 28, borderColor: colors.primary },
  cornerTopLeft: { left: 14, top: 14, borderLeftWidth: 3, borderTopWidth: 3 },
  cornerTopRight: { right: 14, top: 14, borderRightWidth: 3, borderTopWidth: 3 },
  cornerBottomLeft: { left: 14, bottom: 14, borderLeftWidth: 3, borderBottomWidth: 3 },
  cornerBottomRight: { right: 14, bottom: 14, borderRightWidth: 3, borderBottomWidth: 3 },
  horizonLine: { position: 'absolute', left: '18%', right: '18%', height: 1, backgroundColor: colors.accentSoft },
  previewText: { color: colors.subtle, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  mapCard: { gap: 12, padding: 18, borderRadius: 24, backgroundColor: colors.surfaceGlass, borderWidth: 1, borderColor: colors.border },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionEyebrow: { color: colors.subtle, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  mapDistance: { color: colors.accent, fontSize: 12, fontWeight: '800' },
  statusCard: { backgroundColor: colors.surfaceGlass, borderRadius: 24, padding: 22, gap: 18, borderWidth: 1, borderColor: colors.primary, shadowColor: colors.primary, shadowOpacity: 0.1, shadowRadius: 18 },
  statusTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusLabel: { color: colors.primary, fontSize: 12, fontWeight: '900', letterSpacing: 1.4 },
  instruction: { color: colors.text, fontSize: 26, lineHeight: 38, fontWeight: '700' },
  progress: { color: colors.subtle, fontSize: 12, marginTop: 3 },
  speakerGlyph: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  speakerGlyphText: { color: colors.primary, fontSize: 11, fontWeight: '900' },
  locationCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: 18, padding: 16, gap: 13, borderWidth: 1, borderColor: colors.borderSoft },
  locationIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  locationIconText: { color: colors.accent, fontSize: 23, fontWeight: '900' },
  locationCopy: { flex: 1, gap: 4 },
  locationLabel: { color: colors.subtle, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  locationText: { color: colors.text, fontSize: 15, lineHeight: 22 },
  actions: { gap: 12 },
  secondaryActions: { flexDirection: 'row', gap: 10 },
  actionHalf: { flex: 1 },
  footnoteCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 15, padding: 13, backgroundColor: 'rgba(83,27,27,0.66)', borderWidth: 1, borderColor: '#7F3838' },
  footnoteIcon: { width: 24, height: 24, borderRadius: 12, textAlign: 'center', lineHeight: 24, backgroundColor: colors.danger, color: '#4C1D1D', fontWeight: '900' },
  footnote: { flex: 1, color: colors.danger, fontSize: 13, lineHeight: 20 },
});
