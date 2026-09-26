import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { requestRoutes, type RouteOption } from '@/src/api/client';
import { LargeActionButton } from '@/src/components/LargeActionButton';
import { colors } from '@/src/theme';
import { speak } from '@/src/voice/speak';

function firstParam(value: string | string[] | undefined, fallback: string): string {
  return Array.isArray(value) ? (value[0] ?? fallback) : (value ?? fallback);
}

function routeSpeechSummary(destination: string, routes: RouteOption[]): string {
  const choices = routes.map((route, index) => (
    `${index + 1}번 ${route.name}. ${route.durationMinutes}분, ${route.distanceMeters}미터, ` +
    `계단 ${route.hasStairs ? '있음' : '없음'}, 측정 소음 ${route.noiseLevel}. ` +
    `${route.dataFreshness}. 불확실성 안내: ${route.uncertainty}`
  ));
  return `${destination}까지 두 가지 검증된 데모 경로입니다. ${choices.join(' 다음 선택지. ')} 원하는 경로 버튼을 선택하세요.`;
}

export default function RoutesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ destination?: string | string[] }>();
  const destination = firstParam(params.destination, '선택한 목적지');
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void requestRoutes(destination).then(({ routes: loadedRoutes, source }) => {
      if (cancelled) return;
      setRoutes(loadedRoutes);
      setIsDemo(source === 'demo');
      setIsLoading(false);
      void speak(routeSpeechSummary(destination, loadedRoutes), false);
    });

    return () => {
      cancelled = true;
    };
  }, [destination]);

  const chooseRoute = (route: RouteOption, index: number) => {
    const message = `${index + 1}번 ${route.name}을 선택했습니다.`;
    void speak(message);
    router.push({
      pathname: '/navigate',
      params: { destination, routeId: route.id },
    });
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>{destination} 경로</Text>
      <Text style={styles.intro}>시간, 계단 포함 여부와 상대적 소음 정보를 비교하세요.</Text>

      {isDemo && (
        <View accessibilityRole="alert" style={styles.demoBanner}>
          <Text style={styles.demoText}>서버에 연결되지 않아 검토된 데모 경로를 표시합니다.</Text>
        </View>
      )}

      {isLoading ? (
        <View accessibilityLabel="경로를 불러오는 중" style={styles.loading}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>경로를 불러오고 있습니다.</Text>
        </View>
      ) : (
        <View style={styles.routeList}>
          {routes.map((route, index) => (
            <Pressable
              key={route.id}
              accessibilityRole="button"
              accessibilityLabel={`${index + 1}번 ${route.name}, ${route.durationMinutes}분, ${route.distanceMeters}미터, 계단 ${route.hasStairs ? '있음' : '없음'}, 측정 소음 ${route.noiseLevel}, ${route.dataFreshness}, 불확실성: ${route.uncertainty}`}
              accessibilityHint="이 경로로 모의 안내를 시작합니다"
              onPress={() => chooseRoute(route, index)}
              style={({ pressed }) => [styles.routeCard, pressed && styles.pressed]}
            >
              <Text style={styles.routeNumber}>{index + 1}번</Text>
              <Text style={styles.routeName}>{route.name}</Text>
              <Text style={styles.routeSummary}>{route.summary}</Text>
              <View style={styles.metrics} accessible={false}>
                <Text style={styles.metric}>{route.durationMinutes}분</Text>
                <Text style={styles.metric}>{route.distanceMeters}m</Text>
                <Text style={styles.metric}>{route.hasStairs ? '계단 있음' : '계단 없음'}</Text>
                <Text style={styles.metric}>소음 {route.noiseLevel}</Text>
              </View>
              <Text style={styles.freshness}>{route.dataFreshness}</Text>
              <Text style={styles.uncertainty}>불확실성: {route.uncertainty}</Text>
            </Pressable>
          ))}
          <LargeActionButton
            label="경로 선택지 다시 듣기"
            accessibilityHint="두 경로의 시간, 계단, 소음, 데이터 최신성과 불확실성을 다시 읽습니다"
            onPress={() => void speak(routeSpeechSummary(destination, routes))}
            variant="secondary"
          />
        </View>
      )}

      <Text style={styles.note}>소음은 측정 당시의 상대값이며 사람 수나 현재 혼잡도를 의미하지 않습니다.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { padding: 24, gap: 18 },
  title: { color: colors.text, fontSize: 30, fontWeight: '800' },
  intro: { color: colors.muted, fontSize: 18, lineHeight: 27 },
  demoBanner: { backgroundColor: '#4A3410', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: colors.warning },
  demoText: { color: colors.warning, fontSize: 17, lineHeight: 25 },
  loading: { minHeight: 240, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { color: colors.text, fontSize: 18 },
  routeList: { gap: 16 },
  routeCard: { minHeight: 180, backgroundColor: colors.surface, borderRadius: 18, borderWidth: 2, borderColor: colors.border, padding: 20, gap: 8 },
  pressed: { opacity: 0.76, borderColor: colors.primary },
  routeNumber: { color: colors.primary, fontSize: 17, fontWeight: '700' },
  routeName: { color: colors.text, fontSize: 25, fontWeight: '800' },
  routeSummary: { color: colors.muted, fontSize: 17, lineHeight: 25 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  metric: { color: colors.text, backgroundColor: colors.surfaceRaised, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, fontSize: 16 },
  freshness: { color: colors.primary, fontSize: 15, lineHeight: 22, marginTop: 4 },
  uncertainty: { color: colors.warning, fontSize: 15, lineHeight: 22 },
  note: { color: colors.warning, fontSize: 15, lineHeight: 23 },
});
