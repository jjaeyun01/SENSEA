import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { requestRoutes, type RouteOption } from '@/src/api/client';
import { LargeActionButton } from '@/src/components/LargeActionButton';
import { AppBackdrop } from '@/src/components/AppBackdrop';
import { colors } from '@/src/theme';
import { speak } from '@/src/voice/speak';

function firstParam(value: string | string[] | undefined, fallback: string): string {
  return Array.isArray(value) ? (value[0] ?? fallback) : (value ?? fallback);
}

function routeSpeechSummary(destination: string, routes: RouteOption[]): string {
  const choices = routes.map((route, index) => (
    `${index + 1}번 ${route.name}. ${route.durationMinutes}분, ${route.distanceMeters}미터, ` +
    `계단 ${route.hasStairs ? '있음' : '없음'}, 측정 소음 ${route.noiseLevel}. ` +
    `${route.noiseDataStatus === 'stale' ? '주의, 소음 데이터가 오래되어 참고용입니다. ' : ''}` +
    `${route.noiseDataStatus === 'unknown' ? '일부 구간의 소음 데이터가 없습니다. ' : ''}` +
    `${route.dataFreshness}. 불확실성 안내: ${route.uncertainty}`
  ));
  return `${destination}까지 ${routes.length}가지 검증된 데모 경로입니다. ${choices.join(' 다음 선택지. ')} 원하는 경로 버튼을 선택하세요.`;
}

function routeCategory(route: RouteOption): string {
  if (route.routeType === 'shortest') return 'TIME';
  if (route.routeType === 'flat') return 'FLAT ROAD';
  return 'SAFETY';
}

function estimatedArrival(durationMinutes: number): string {
  const arrival = new Date(Date.now() + durationMinutes * 60_000);
  return arrival.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
}

const routeOrder: Record<RouteOption['routeType'], number> = {
  shortest: 0,
  flat: 1,
  safe: 2,
};

export default function RoutesScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 960;
  const params = useLocalSearchParams<{ destination?: string | string[] }>();
  const destination = firstParam(params.destination, '선택한 목적지');
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void requestRoutes(destination).then(({ routes: loadedRoutes, source, error }) => {
      if (cancelled) return;
      if (source === 'unavailable' || loadedRoutes.length === 0) {
        const message = error ?? '이 목적지에는 검증된 보행 경로가 없습니다. 다른 목적지를 입력해주세요.';
        setRoutes([]);
        setErrorMessage(message);
        setIsLoading(false);
        void speak(message, false);
        return;
      }
      const orderedRoutes = [...loadedRoutes].sort(
        (first, second) => routeOrder[first.routeType] - routeOrder[second.routeType],
      );
      setRoutes(orderedRoutes);
      setIsDemo(source === 'demo');
      setErrorMessage(null);
      setIsLoading(false);
      void speak(routeSpeechSummary(destination, orderedRoutes), false);
    });

    return () => {
      cancelled = true;
    };
  }, [destination]);

  const chooseRoute = (route: RouteOption, index: number) => {
    const message = `${index + 1}번 ${route.name}을 선택했습니다.`;
    void speak(message);
    router.push({ pathname: '/camera', params: { destination, routeId: route.id, mode: 'setup' } });
  };

  return (
    <View style={styles.root}>
      <AppBackdrop />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <View style={styles.eyebrowRow}><View style={styles.eyebrowDot} /><Text style={styles.eyebrow}>ROUTE OPTIONS</Text></View>
            <Text accessibilityRole="header" style={styles.title}>나에게 맞는 경로를 선택하세요.</Text>
            <Text style={styles.intro}><Text style={styles.destination}>{destination}</Text>까지 시간, 지형과 검토 정보를 비교할 수 있습니다.</Text>
          </View>
          <View style={styles.stepIndicator} accessible accessibilityLabel="전체 네 단계 중 경로 선택 세 번째 단계">
            <Text style={styles.stepIndicatorLabel}>STEP</Text>
            <Text style={styles.stepIndicatorValue}>03 / 04</Text>
          </View>
        </View>

        {isDemo && (
        <View accessibilityRole="alert" style={styles.demoBanner}>
          <Text style={styles.demoText}>서버에 연결되지 않아 검토된 데모 경로를 표시합니다.</Text>
        </View>
        )}

        {errorMessage && (
        <View accessibilityRole="alert" style={styles.errorBanner}>
          <Text accessibilityRole="header" style={styles.errorTitle}>경로를 찾을 수 없습니다</Text>
          <Text accessibilityLiveRegion="assertive" style={styles.errorText}>{errorMessage}</Text>
          <LargeActionButton
            label="목적지 다시 입력"
            accessibilityHint="목적지 입력 화면으로 돌아갑니다"
            onPress={() => router.back()}
            variant="secondary"
          />
        </View>
        )}

        {isLoading ? (
        <View accessibilityLabel="경로를 불러오는 중" style={styles.loading}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>경로를 불러오고 있습니다.</Text>
        </View>
      ) : !errorMessage ? (
        <View style={styles.routeList}>
          <View style={[styles.routeGrid, isWide && styles.routeGridWide]}>
            {routes.map((route, index) => (
            <Pressable
              key={route.id}
              accessibilityRole="button"
              accessibilityLabel={`${index + 1}번 ${routeCategory(route)}, ${route.name}, ${route.durationMinutes}분, 예상 도착 ${estimatedArrival(route.durationMinutes)}, ${route.distanceMeters}미터, 계단 ${route.hasStairs ? '있음' : '없음'}, 측정 소음 ${route.noiseLevel}, ${route.noiseDataStatus === 'stale' ? '주의, 오래된 소음 데이터' : route.noiseDataStatus === 'unknown' ? '일부 소음 데이터 없음' : '최신 소음 데이터'}, ${route.dataFreshness}, 불확실성: ${route.uncertainty}`}
              accessibilityHint="이 경로를 선택하고 카메라 설정으로 이동합니다"
              onPress={() => chooseRoute(route, index)}
              style={({ pressed }) => [styles.routeCard, isWide && styles.routeCardWide, route.routeType === 'flat' && styles.recommendedCard, pressed && styles.pressed]}
            >
              {route.routeType === 'flat' && <View style={styles.recommendedRibbon}><Text style={styles.recommendedText}>RECOMMENDED</Text></View>}
              <View style={styles.cardTopRow}>
                <Text style={styles.routeNumber}>{index + 1}</Text>
                <View style={styles.categoryBlock}>
                  <Text style={styles.category}>{routeCategory(route)}</Text>
                  <Text style={styles.categoryHint}>{route.routeType === 'shortest' ? '가장 빠르게' : route.routeType === 'flat' ? '계단 없이 편안하게' : '검토 구간 중심으로'}</Text>
                </View>
                <View style={[styles.routeGlyph, route.routeType === 'shortest' ? styles.glyphBlue : route.routeType === 'flat' ? styles.glyphMint : styles.glyphAmber]} accessible={false}>
                  <Text style={styles.routeGlyphText}>{route.routeType === 'shortest' ? '↗' : route.routeType === 'flat' ? '⌁' : '◇'}</Text>
                </View>
              </View>
              <Text style={styles.routeName}>{route.name}</Text>
              <Text style={styles.routeSummary}>{route.summary}</Text>
              <View style={styles.primaryMetric} accessible={false}>
                <Text style={styles.primaryMetricValue}>{route.durationMinutes}</Text>
                <View><Text style={styles.primaryMetricUnit}>MIN</Text><Text style={styles.primaryMetricSub}>도착 {estimatedArrival(route.durationMinutes)}</Text></View>
              </View>
              <View style={styles.metrics} accessible={false}>
                <View style={styles.metric}><Text style={styles.metricLabel}>거리</Text><Text style={styles.metricValue}>{route.distanceMeters}m</Text></View>
                <View style={styles.metric}><Text style={styles.metricLabel}>지형</Text><Text style={styles.metricValue}>{route.hasStairs ? '계단 포함' : '계단 없음'}</Text></View>
                <View style={styles.metric}><Text style={styles.metricLabel}>소음</Text><Text style={styles.metricValue}>{route.noiseLevel}</Text></View>
              </View>
              <View style={styles.dataStatus}>
                <View style={[styles.statusDot, route.noiseDataStatus === 'fresh' ? styles.statusFresh : styles.statusWarning]} />
                <Text style={route.noiseDataStatus === 'fresh' ? styles.freshness : styles.stale}>{route.noiseDataStatus === 'stale' ? '주의 · ' : route.noiseDataStatus === 'unknown' ? '데이터 제한 · ' : ''}{route.dataFreshness}</Text>
              </View>
              <View style={styles.uncertaintyBox}><Text style={styles.uncertaintyLabel}>UNCERTAINTY</Text><Text style={styles.uncertainty}>{route.uncertainty}</Text></View>
              <View style={styles.selectHint}><Text style={styles.selectHintText}>이 경로 선택</Text><Text style={styles.selectArrow}>→</Text></View>
            </Pressable>
            ))}
          </View>
          <LargeActionButton
            label="경로 선택지 다시 듣기"
            accessibilityHint="세 경로의 시간, 계단, 소음, 데이터 최신성과 불확실성을 다시 읽습니다"
            onPress={() => void speak(routeSpeechSummary(destination, routes))}
            variant="secondary"
          />
        </View>
        ) : null}

        <View style={styles.noteCard}><Text style={styles.noteIcon}>i</Text><Text style={styles.note}>소음은 측정 당시의 상대값이며 사람 수나 현재 혼잡도를 의미하지 않습니다.</Text></View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { width: '100%', maxWidth: 1240, alignSelf: 'center', padding: 24, gap: 22, paddingBottom: 56 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18 },
  headerCopy: { flex: 1, gap: 8 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyebrowDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  title: { color: colors.text, fontSize: 36, lineHeight: 44, fontWeight: '900' },
  intro: { color: colors.muted, fontSize: 18, lineHeight: 27 },
  destination: { color: colors.accent, fontWeight: '900' },
  stepIndicator: { minWidth: 92, padding: 14, borderRadius: 18, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', gap: 3 },
  stepIndicatorLabel: { color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  stepIndicatorValue: { color: colors.text, fontSize: 16, fontWeight: '900' },
  demoBanner: { backgroundColor: '#4A3410', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: colors.warning },
  demoText: { color: colors.warning, fontSize: 17, lineHeight: 25 },
  errorBanner: { backgroundColor: '#4C1D1D', borderRadius: 14, padding: 18, gap: 14, borderWidth: 2, borderColor: colors.danger },
  errorTitle: { color: colors.text, fontSize: 22, fontWeight: '800' },
  errorText: { color: colors.text, fontSize: 18, lineHeight: 27 },
  loading: { minHeight: 240, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { color: colors.text, fontSize: 18 },
  routeList: { gap: 18 },
  routeGrid: { gap: 16 },
  routeGridWide: { flexDirection: 'row', alignItems: 'stretch' },
  routeCard: { minHeight: 180, backgroundColor: colors.surfaceGlass, borderRadius: 24, borderWidth: 1, borderColor: colors.border, padding: 20, gap: 12, overflow: 'hidden', shadowColor: '#000000', shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.24, shadowRadius: 22, elevation: 6 },
  routeCardWide: { flex: 1 },
  recommendedCard: { borderColor: colors.primary, backgroundColor: 'rgba(16, 45, 52, 0.94)' },
  recommendedRibbon: { position: 'absolute', top: 0, right: 0, backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 7, borderBottomLeftRadius: 13 },
  recommendedText: { color: colors.primaryText, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  pressed: { opacity: 0.76, borderColor: colors.primary },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 4 },
  routeNumber: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, color: colors.primaryText, fontSize: 19, lineHeight: 36, textAlign: 'center', fontWeight: '900' },
  categoryBlock: { flex: 1, gap: 2 },
  category: { color: colors.primary, fontSize: 13, fontWeight: '900', letterSpacing: 1.4 },
  categoryHint: { color: colors.subtle, fontSize: 11 },
  routeGlyph: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  glyphBlue: { backgroundColor: colors.accentSoft },
  glyphMint: { backgroundColor: colors.primarySoft },
  glyphAmber: { backgroundColor: '#554512' },
  routeGlyphText: { color: colors.text, fontSize: 21, fontWeight: '900' },
  routeName: { color: colors.text, fontSize: 25, fontWeight: '800' },
  routeSummary: { color: colors.muted, fontSize: 17, lineHeight: 25 },
  primaryMetric: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingVertical: 2 },
  primaryMetricValue: { color: colors.text, fontSize: 48, lineHeight: 52, fontWeight: '900', letterSpacing: -2 },
  primaryMetricUnit: { color: colors.accent, fontSize: 12, fontWeight: '900', letterSpacing: 1.3 },
  primaryMetricSub: { color: colors.subtle, fontSize: 12, marginTop: 2 },
  metrics: { flexDirection: 'row', gap: 7 },
  metric: { flex: 1, minWidth: 76, backgroundColor: colors.surfaceRaised, borderRadius: 12, padding: 10, gap: 3 },
  metricLabel: { color: colors.subtle, fontSize: 10, fontWeight: '800' },
  metricValue: { color: colors.text, fontSize: 13, fontWeight: '800' },
  dataStatus: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusFresh: { backgroundColor: colors.primary },
  statusWarning: { backgroundColor: colors.warning },
  freshness: { flex: 1, color: colors.primary, fontSize: 13, lineHeight: 19 },
  stale: { flex: 1, color: colors.warning, fontSize: 13, fontWeight: '700', lineHeight: 19 },
  uncertaintyBox: { gap: 4, padding: 12, borderRadius: 13, backgroundColor: 'rgba(7,17,31,0.48)' },
  uncertaintyLabel: { color: colors.subtle, fontSize: 9, fontWeight: '900', letterSpacing: 1.3 },
  uncertainty: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  selectHint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 },
  selectHintText: { color: colors.text, fontSize: 14, fontWeight: '900' },
  selectArrow: { color: colors.primary, fontSize: 22, fontWeight: '900' },
  noteCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 15, padding: 14, backgroundColor: 'rgba(74,52,16,0.65)', borderWidth: 1, borderColor: '#745D25' },
  noteIcon: { width: 24, height: 24, borderRadius: 12, lineHeight: 24, textAlign: 'center', backgroundColor: colors.warning, color: '#4A3410', fontWeight: '900' },
  note: { flex: 1, color: colors.warning, fontSize: 14, lineHeight: 21 },
});
