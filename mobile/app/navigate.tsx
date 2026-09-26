import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { requestRoutes, type NavigationStep, type RouteOption } from '@/src/api/client';
import { LargeActionButton } from '@/src/components/LargeActionButton';
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
  const [locationStatus, setLocationStatus] = useState('위치를 확인하고 있습니다.');
  const [lastMessage, setLastMessage] = useState('안내를 준비하고 있습니다.');

  const issueGuidance = (message: GuidanceMessage) => {
    queue.current.enqueue(message);
    const next = queue.current.next();
    if (!next) return;
    vibrateForPriority(next.priority);
    setLastMessage(next.text);
    AccessibilityInfo.announceForAccessibility(next.text);
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
      const startMessage = `${selected.name} 안내를 시작합니다. 현재 화면은 경유지 이동을 모의 실행합니다.`;
      setLastMessage(startMessage);
      void speak(startMessage);
    });

    void getCurrentLocation().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLocationStatus(result.reason);
        return;
      }
      const accuracy = result.accuracyMeters;
      if (accuracy !== null && accuracy > 30) {
        setLocationStatus(`현재 위치 오차가 약 ${Math.round(accuracy)}미터로 큽니다. 방향 안내가 부정확할 수 있습니다.`);
      } else {
        setLocationStatus('현재 위치를 확인했습니다.');
      }
    });

    return () => {
      cancelled = true;
      queue.current.clear();
      Vibration.cancel();
    };
  }, [destination, routeId]);

  const currentStep: NavigationStep | undefined = route?.steps[stepIndex];

  const repeatInstruction = () => {
    if (!currentStep) return;
    issueGuidance({
      id: `repeat-${currentStep.id}-${Date.now()}`,
      priority: currentStep.priority,
      text: currentStep.instruction,
    });
  };

  const advanceStep = () => {
    if (!route || !currentStep || paused) return;
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
    issueGuidance({ id: nextStep.id, priority: nextStep.priority, text: nextStep.instruction });
  };

  const togglePause = () => {
    const nextPaused = !paused;
    setPaused(nextPaused);
    const message = nextPaused ? '안내를 일시 정지했습니다.' : '안내를 다시 시작합니다.';
    issueGuidance({ id: `pause-${Date.now()}`, priority: 2, text: message });
  };

  const simulateUrgentHazard = () => {
    if (currentStep) {
      queue.current.enqueue({
        id: `pending-${currentStep.id}-${Date.now()}`,
        priority: currentStep.priority,
        text: currentStep.instruction,
      });
    }
    issueGuidance({
      id: `hazard-${Date.now()}`,
      priority: 0,
      text: '긴급 위험 알림 데모입니다. 전방 장애물 가능성이 있습니다. 즉시 멈추고 주변을 확인하세요.',
    });
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
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>{destination}</Text>
      <Text style={styles.routeName}>{route.name} · 약 {route.durationMinutes}분</Text>

      <View accessibilityRole="alert" style={styles.prototypeBanner}>
        <Text style={styles.prototypeText}>모의 안내입니다. 실시간 장애물 감지나 안전한 횡단을 보장하지 않습니다.</Text>
      </View>

      <View style={styles.statusCard}>
        <Text style={styles.statusLabel}>현재 안내</Text>
        <Text accessibilityLiveRegion="assertive" style={styles.instruction}>{lastMessage}</Text>
        <Text style={styles.progress}>경유지 {Math.min(stepIndex + 1, route.steps.length)} / {route.steps.length}</Text>
      </View>

      <View style={styles.locationCard}>
        <Text style={styles.locationLabel}>위치 상태</Text>
        <Text accessibilityLiveRegion="polite" style={styles.locationText}>{locationStatus}</Text>
      </View>

      <View style={styles.actions}>
        <LargeActionButton
          label={arrived ? '안내 완료' : paused ? '일시 정지 중' : '다음 경유지 안내'}
          accessibilityHint="모의 이동을 다음 경유지로 진행합니다"
          onPress={advanceStep}
          disabled={paused || arrived}
        />
        <LargeActionButton
          label="현재 안내 다시 듣기"
          onPress={repeatInstruction}
          variant="secondary"
        />
        <LargeActionButton
          label={paused ? '안내 계속하기' : '안내 일시 정지'}
          onPress={togglePause}
          variant="secondary"
        />
        <LargeActionButton
          label="카메라로 주변 확인"
          accessibilityHint="사용자가 요청할 때만 카메라 화면을 엽니다"
          onPress={() => router.push('/camera')}
          variant="secondary"
        />
        <LargeActionButton
          label="P0 긴급 알림 시험"
          accessibilityHint="우선순위 큐의 긴급 경고 진동과 음성을 시험합니다"
          onPress={simulateUrgentHazard}
          variant="danger"
        />
      </View>

      <Text style={styles.footnote}>긴급 알림 버튼은 우선순위 큐 동작을 보여주기 위한 데모이며 실제 장애물을 감지하지 않습니다.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { padding: 24, gap: 18, paddingBottom: 48 },
  loading: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  loadingText: { color: colors.text, fontSize: 18, textAlign: 'center' },
  title: { color: colors.text, fontSize: 30, fontWeight: '800' },
  routeName: { color: colors.primary, fontSize: 19, fontWeight: '700' },
  prototypeBanner: { backgroundColor: '#4A3410', borderColor: colors.warning, borderWidth: 1, borderRadius: 12, padding: 15 },
  prototypeText: { color: colors.warning, fontSize: 16, lineHeight: 24 },
  statusCard: { backgroundColor: colors.surface, borderRadius: 20, padding: 22, gap: 12, borderWidth: 2, borderColor: colors.primary },
  statusLabel: { color: colors.primary, fontSize: 17, fontWeight: '700' },
  instruction: { color: colors.text, fontSize: 26, lineHeight: 38, fontWeight: '700' },
  progress: { color: colors.muted, fontSize: 16 },
  locationCard: { backgroundColor: colors.surfaceRaised, borderRadius: 14, padding: 16, gap: 6 },
  locationLabel: { color: colors.muted, fontSize: 15, fontWeight: '700' },
  locationText: { color: colors.text, fontSize: 17, lineHeight: 25 },
  actions: { gap: 12 },
  footnote: { color: colors.danger, fontSize: 15, lineHeight: 23 },
});

