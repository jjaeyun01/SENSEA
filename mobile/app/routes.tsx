import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, getRoutes, type RouteOption } from '@/src/api/client';
import { AppHeader } from '@/src/components/AppHeader';
import { LargeActionButton } from '@/src/components/LargeActionButton';
import { useNavigationState } from '@/src/state/NavigationState';
import { colors, radii, spacing, typography } from '@/src/theme';
import { speak } from '@/src/voice/speak';

function noiseText(route: RouteOption) {
  if (route.noise_data_status === 'unknown') return 'Noise level unknown';
  if (route.noise_data_status === 'stale') return 'Older noise sample';
  if ((route.relative_noise ?? 1) < 0.4) return 'Lower measured noise';
  return 'Moderate measured noise';
}

export default function RoutesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [state, dispatch] = useNavigationState();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!state.destination) { router.replace('/'); return; }
    setLoading(true); setError(null);
    try {
      const routes = await getRoutes({ start_waypoint: 'start', end_waypoint: state.destination.entrance_waypoint, noise_preference: 'quiet' });
      dispatch({ type: 'ROUTES', routes });
      void speak(routes.map((route) => `${route.label}: ${route.distance_m} meters. ${noiseText(route)}.`).join(' '));
    } catch (e) { const message = e instanceof ApiError ? e.message : 'Routes could not be loaded.'; setError(message); void speak(message); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);
  const choose = (route: RouteOption) => { dispatch({ type: 'SELECT_ROUTE', route }); void speak(`${route.label} selected. Start navigation when ready.`); router.push('/navigate'); };

  if (loading) return <View accessibilityLabel="Loading route alternatives" style={styles.center}><View style={styles.loaderRing}><ActivityIndicator color={colors.primary} size="large" /></View><Text style={styles.loadingTitle}>Finding your best routes</Text><Text style={styles.loadingText}>Checking distance, pedestrian verification and noise data…</Text></View>;

  return <ScrollView style={styles.root} contentContainerStyle={[styles.container, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 36 }]} showsVerticalScrollIndicator={false}>
    <AppHeader title="Select a route" eyebrow={state.destination?.name} onBack={() => router.back()} />
    <Text style={styles.intro}>Compare verified options. Noise readings describe the environment, not crowd size.</Text>
    {error && <View accessibilityRole="alert" style={styles.error}><View style={styles.errorIcon}><Text style={styles.errorIconText}>!</Text></View><Text style={styles.errorTitle}>We couldn’t load routes</Text><Text style={styles.errorText}>{error}</Text><LargeActionButton label="Try again" onPress={() => void load()} /><LargeActionButton label="Change destination" onPress={() => router.replace('/')} variant="ghost" /></View>}
    <View style={styles.routeList}>
      {state.routes.map((route, index) => {
        const shortest = state.routes[0];
        const extra = index > 0 && shortest ? route.distance_m - shortest.distance_m : 0;
        const minutes = Math.max(1, Math.round(route.distance_m / 75));
        return <Pressable key={route.id} accessibilityRole="button" accessibilityLabel={`${route.label}, ${minutes} minutes, ${route.distance_m} meters, ${noiseText(route)}`} onPress={() => choose(route)} style={({ pressed }) => [styles.card, index === 0 && styles.cardRecommended, pressed && styles.cardPressed]}>
          <View style={styles.cardTop}><View style={styles.number}><Text style={styles.numberText}>{index + 1}</Text></View>{index === 0 && <View style={styles.recommended}><Text style={styles.recommendedText}>RECOMMENDED</Text></View>}</View>
          <Text style={styles.routeTitle}>{route.label}</Text>
          <View style={styles.metrics}><Text style={styles.duration}>{minutes} min</Text><Text style={styles.dot}>•</Text><Text style={styles.distance}>{route.distance_m} m</Text></View>
          <View style={styles.divider} />
          <View style={styles.tags}><Tag label={noiseText(route)} accent={route.noise_data_status === 'measured'} /><Tag label={extra > 0 ? `${extra} m longer` : 'Most direct'} /><Tag label="Pedestrian verified" /></View>
          <View style={styles.selectRow}><Text style={styles.selectText}>Choose this route</Text><Text style={styles.selectArrow}>→</Text></View>
        </Pressable>;
      })}
    </View>
    {state.routes.length > 0 && <Text style={styles.freshness}>Route data checked for pedestrian access · Noise freshness varies by segment</Text>}
    {state.routes.length > 0 && <LargeActionButton label="Hear route choices again" onPress={() => void speak(state.routes.map((route) => `${route.label}: ${route.distance_m} meters. ${noiseText(route)}.`).join(' '))} variant="ghost" />}
  </ScrollView>;
}

function Tag({ label, accent = false }: { label: string; accent?: boolean }) { return <View style={[styles.tag, accent && styles.tagAccent]}><Text style={[styles.tagText, accent && styles.tagTextAccent]}>{label}</Text></View>; }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background }, container: { paddingHorizontal: spacing.lg, gap: spacing.md }, center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 }, loaderRing: { width: 86, height: 86, borderRadius: 43, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 8 }, loadingTitle: { color: colors.text, fontFamily: typography.family, fontSize: 22, fontWeight: '900', textAlign: 'center' }, loadingText: { color: colors.muted, fontFamily: typography.family, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  intro: { color: colors.muted, fontFamily: typography.family, fontSize: 16, lineHeight: 24, marginTop: -8, marginBottom: 6 }, routeList: { gap: 14 },
  card: { borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 20, gap: 10 }, cardRecommended: { borderWidth: 2, borderColor: colors.primary, backgroundColor: '#101C21' }, cardPressed: { transform: [{ scale: 0.99 }], backgroundColor: colors.surfaceRaised }, cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, number: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center' }, numberText: { color: colors.textSoft, fontFamily: typography.family, fontSize: 14, fontWeight: '900' }, recommended: { borderRadius: radii.pill, paddingHorizontal: 11, paddingVertical: 7, backgroundColor: colors.primary }, recommendedText: { color: colors.primaryText, fontFamily: typography.family, fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  routeTitle: { color: colors.text, fontFamily: typography.family, fontSize: 25, fontWeight: '900', marginTop: 4 }, metrics: { flexDirection: 'row', alignItems: 'baseline', gap: 8 }, duration: { color: colors.primary, fontFamily: typography.family, fontSize: 26, fontWeight: '900' }, dot: { color: colors.mutedDark, fontSize: 18 }, distance: { color: colors.muted, fontFamily: typography.family, fontSize: 17, fontWeight: '700' }, divider: { height: 1, backgroundColor: colors.border, marginVertical: 4 }, tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, tag: { paddingHorizontal: 10, paddingVertical: 7, backgroundColor: colors.surfaceHighlight, borderRadius: radii.pill }, tagAccent: { backgroundColor: colors.primarySoft }, tagText: { color: colors.textSoft, fontFamily: typography.family, fontSize: 12, fontWeight: '700' }, tagTextAccent: { color: colors.primary }, selectRow: { marginTop: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, selectText: { color: colors.text, fontFamily: typography.family, fontSize: 16, fontWeight: '800' }, selectArrow: { color: colors.primary, fontSize: 25, fontWeight: '800' }, freshness: { color: colors.mutedDark, fontFamily: typography.family, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  error: { gap: 12, backgroundColor: colors.dangerSoft, padding: 20, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.danger }, errorIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' }, errorIconText: { color: colors.white, fontSize: 24, fontWeight: '900' }, errorTitle: { color: colors.text, fontFamily: typography.family, fontSize: 21, fontWeight: '900' }, errorText: { color: colors.textSoft, fontFamily: typography.family, fontSize: 15, lineHeight: 22 },
});
