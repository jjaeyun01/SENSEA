import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ApiError, getRoutes, type RouteOption } from '@/src/api/client';
import { LargeActionButton } from '@/src/components/LargeActionButton';
import { useNavigationState } from '@/src/state/NavigationState';
import { colors } from '@/src/theme';
import { speak } from '@/src/voice/speak';

function noiseText(route: RouteOption) {
  if (route.noise_data_status === 'unknown') return 'Noise data unknown; missing data is not treated as quiet.';
  if (route.noise_data_status === 'stale') return `Stale relative noise measurement: ${route.relative_noise ?? 'unknown'}.`;
  return `Recent relative noise index ${route.relative_noise}, measured ${route.noise_freshness_minutes} minutes ago.`;
}

export default function RoutesScreen() {
  const router = useRouter(); const [state, dispatch] = useNavigationState();
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const load = async () => {
    if (!state.destination) { router.replace('/'); return; }
    setLoading(true); setError(null);
    try {
      const routes = await getRoutes({ start_waypoint: 'start', end_waypoint: state.destination.entrance_waypoint, noise_preference: 'quiet' });
      dispatch({ type: 'ROUTES', routes });
      const summary = routes.map((route) => `${route.label}: ${route.distance_m} meters. ${noiseText(route)}`).join(' ');
      void speak(summary);
    } catch (e) { const message = e instanceof ApiError ? e.message : 'Routes could not be loaded.'; setError(message); void speak(message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const choose = (route: RouteOption) => { dispatch({ type: 'SELECT_ROUTE', route }); void speak(`${route.label} selected. Start navigation when ready.`); router.push('/navigate'); };
  if (loading) return <View accessibilityLabel="Loading route alternatives" style={styles.center}><ActivityIndicator color={colors.primary} size="large" /><Text style={styles.text}>Loading verified pedestrian routes…</Text></View>;
  return <ScrollView style={styles.root} contentContainerStyle={styles.container}><Text accessibilityRole="header" style={styles.title}>Route choices</Text><Text style={styles.text}>Compare distance and measured relative noise. Noise does not indicate crowd size.</Text>
    {error && <View accessibilityRole="alert" style={styles.error}><Text style={styles.text}>{error}</Text><LargeActionButton label="Try routes again" onPress={() => void load()} /><LargeActionButton label="Back to destination" onPress={() => router.back()} variant="secondary" /></View>}
    {state.routes.map((route, index) => { const shortest = state.routes[0]; const extra = index > 0 && shortest ? route.distance_m - shortest.distance_m : 0; return <View key={route.id} accessible accessibilityLabel={`${route.label}, ${route.distance_m} meters. ${noiseText(route)}${extra > 0 ? ` ${extra} meters longer than the shortest route.` : ''}`} style={styles.card}><Text style={styles.routeTitle}>{route.label}</Text><Text style={styles.metric}>{route.distance_m} meters</Text><Text style={styles.text}>{noiseText(route)}</Text>{extra > 0 && <Text style={styles.warning}>{extra} meters longer than the shortest route.</Text>}<LargeActionButton label={`Select ${route.label}`} accessibilityHint="Opens simulated step-by-step guidance" onPress={() => choose(route)} /></View>; })}
    <LargeActionButton label="Hear route choices again" onPress={() => void speak(state.routes.map((route) => `${route.label}: ${route.distance_m} meters. ${noiseText(route)}`).join(' '))} variant="secondary" /><LargeActionButton label="Back" onPress={() => router.back()} variant="secondary" />
  </ScrollView>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.background }, container: { padding: 24, gap: 16 }, center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }, title: { color: colors.text, fontSize: 30, fontWeight: '800' }, text: { color: colors.text, fontSize: 17, lineHeight: 25 }, card: { gap: 12, padding: 20, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.border }, routeTitle: { color: colors.primary, fontSize: 24, fontWeight: '800' }, metric: { color: colors.text, fontSize: 22, fontWeight: '700' }, warning: { color: colors.warning, fontSize: 16 }, error: { gap: 12, backgroundColor: '#4A1D1D', padding: 16, borderRadius: 12 } });
