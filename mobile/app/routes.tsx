import { useEffect } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type Route as RouteOption } from '@/src/navigation/campusApi';
import { useJourney } from '@/src/navigation/JourneyProvider';
import { AppHeader } from '@/src/components/AppHeader';
import { LargeActionButton } from '@/src/components/LargeActionButton';
import { colors, radii, spacing, typography } from '@/src/theme';
function noiseText(route: RouteOption) {
  return route.source === 'demo' ? `Demo noise: ${route.noiseStatus ?? 'unknown'}` : 'Noise level unknown';
}
export default function RoutesScreen() {
  const router = useRouter(); const pathname = usePathname(); const insets = useSafeAreaInsets();
  const journey = useJourney();
  const state = { routes: journey.routes, destination: journey.destination };
  const error = !journey.routes.length && !journey.busy ? journey.message : null;
  const choose = (route: RouteOption) => journey.choose(route);
  const load = () => journey.confirm();
  const speak = (text: string) => journey.say(text);
  useEffect(() => { if (pathname === '/routes' && journey.stage === 'setup') router.push('/navigate'); }, [journey.stage, pathname, router]);
  if (journey.busy) return <View accessibilityLabel="Loading route alternatives" style={styles.center}><View style={styles.loaderRing}><ActivityIndicator color={colors.primary} size="large" /></View><Text style={styles.loadingTitle}>Finding your best routes</Text><Text style={styles.loadingText}>Checking walking distance and estimated duration…</Text></View>;
  return <ScrollView style={styles.root} contentContainerStyle={[styles.container, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 36 }]} showsVerticalScrollIndicator={false}>
    <AppHeader title="Select a route" eyebrow={state.destination?.name} onBack={() => { journey.reset(); router.replace('/'); }} />
    <Text style={styles.intro}>Compare walking options. Stairs, slopes and current conditions are unverified unless explicitly labeled as demo fixtures.</Text>
    {error && <View accessibilityRole="alert" style={styles.error}><View style={styles.errorIcon}><Text style={styles.errorIconText}>!</Text></View><Text style={styles.errorTitle}>We couldn’t load routes</Text><Text style={styles.errorText}>{error}</Text><LargeActionButton label="Try again" onPress={() => void load()} /><LargeActionButton label="Change destination" onPress={() => { journey.reset(); router.replace('/'); }} variant="ghost" /></View>}
    <View style={styles.routeList}>
      {state.routes.map((route, index) => {
        const shortest = state.routes[0];
        const extra = index > 0 && shortest ? route.distance_m - shortest.distance_m : 0;
        const minutes = Math.max(1, Math.ceil(route.duration_seconds / 60));
        return <Pressable key={route.id} accessibilityRole="button" accessibilityLabel={`${route.label}, ${minutes} minutes, ${route.distance_m} meters, ${noiseText(route)}`} onPress={() => choose(route)} style={({ pressed }) => [styles.card, index === 0 && styles.cardRecommended, pressed && styles.cardPressed]}>
          <View style={styles.cardTop}><View style={styles.number}><Text style={styles.numberText}>{index + 1}</Text></View>{index === 0 && <View style={styles.recommended}><Text style={styles.recommendedText}>OPTION 1</Text></View>}</View>
          <Text style={styles.routeTitle}>{route.label}</Text>
          <View style={styles.metrics}><Text style={styles.duration}>{minutes} min</Text><Text style={styles.dot}>•</Text><Text style={styles.distance}>{route.distance_m} m</Text></View>
          <View style={styles.divider} />
          <View style={styles.tags}><Tag label={noiseText(route)} accent={false} /><Tag label={extra > 0 ? `${extra} m longer` : 'Walking route'} /><Tag label={route.source === 'demo' ? (route.hasStairs ? 'Demo: stairs' : 'Demo: no stairs') : 'Accessibility unknown'} /></View>
          {route.warnings.map((warning, i) => <Text key={i} style={styles.freshness}>{warning}</Text>)}
          <View style={styles.selectRow}><Text style={styles.selectText}>Choose this route</Text><Text style={styles.selectArrow}>→</Text></View>
        </Pressable>;
      })}
    </View>
    {state.routes.length > 0 && <Text style={styles.freshness}>{journey.demoMode ? 'SIMULATION ONLY · Manual walkthrough' : 'Google Maps · Building representative point, not a verified entrance'}</Text>}
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
