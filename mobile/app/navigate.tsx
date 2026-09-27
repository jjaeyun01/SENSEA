import { useCallback, useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LargeActionButton } from '@/src/components/LargeActionButton';
import { RouteMap } from '@/src/components/RouteMap';
import { CameraPreview, useCamera } from '@/src/camera/CameraProvider';
import { useJourney } from '@/src/navigation/JourneyProvider';
import { announce } from '@/src/navigation/feedback';
import { colors, radii, spacing, typography } from '@/src/theme';
import { useNoise } from '@/src/noise/NoiseProvider';
export default function NavigateScreen() {
  const router = useRouter(); const pathname = usePathname(); const insets = useSafeAreaInsets(); const journey = useJourney(); const cameraState = useCamera(); const noise = useNoise();
  useFocusEffect(useCallback(() => () => journey.pause(), [journey.pause]));
  const route = journey.selected;
  const state = { destination: journey.destination, stepIndex: journey.stepIndex };
  const started = ['navigating', 'paused', 'arrived'].includes(journey.stage);
  const paused = journey.stage !== 'navigating';
  const segment = route?.steps[journey.stepIndex];
  const remaining = route ? Math.max(0, Math.round(route.distance_m - route.steps.slice(0, journey.stepIndex).reduce((sum, item) => sum + (item.distance_m ?? 0), 0))) : 0;
  const location = journey.message;
  const noiseMessage = route?.source === 'demo' ? `Demo noise fixture: ${route.noiseStatus}. Not a microphone reading.` : noise.collecting ? 'Aggregating a five-second live sound window. No audio file is created.' : noise.latest ? `${noise.latest.label} relative sound level. Private preview until three users contribute to this area.` : noise.status;
  useEffect(() => { if (journey.stage === 'search') router.replace('/'); }, [journey.stage, router]);
  if (!route) return null;
  const start = () => journey.start();
  const next = journey.nextDemo;
  const togglePause = () => { if (paused) void journey.start(); else journey.pause(); };
  const stop = () => { journey.reset(); router.replace('/'); };
  const camera = () => { journey.pause(); router.push('/camera'); };
  const speak = (text: string) => journey.say(text, 2);
  const contributeNoise = () => journey.say(noiseMessage);
  if (!started) return <ScrollView style={styles.root} contentContainerStyle={[styles.preflight, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 30 }]}>
    <Text style={styles.eyebrow}>READY TO GO</Text><Text accessibilityRole="header" style={styles.preflightTitle}>{state.destination?.name}</Text>
    <View style={styles.summaryCard}><View style={styles.routeLine}><View style={styles.routeDot} /><View style={styles.routeStem} /><View style={[styles.routeDot, styles.routeDotEnd]} /></View><View style={styles.summaryCopy}><Text style={styles.summaryLabel}>{route.label}</Text><Text style={styles.summaryMetric}>{Math.max(1, Math.ceil(route.duration_seconds / 60))} min · {route.distance_m} m</Text><Text style={styles.summaryHint}>{route.source === 'demo' ? 'SIMULATION · Manual steps' : 'Google Maps · Accessibility unverified'}</Text></View></View>
    <View style={styles.notice}><Text style={styles.noticeIcon}>i</Text><Text style={styles.noticeText}>{route.source === 'demo' ? 'Fictional demo guidance advances manually.' : route.arrivalTarget?.verifiedEntrance ? 'This route ends at a manually verified entrance coordinate. Stop and visually confirm before entering.' : 'Hold the phone upright facing forward. No verified entrance or VPS alignment is available; the route ends at a representative building point.'}</Text></View>
    <RouteMap route={route} position={journey.position} noiseCells={noise.cells} latestNoise={noise.latest} />
    {route.source !== 'demo' && <><View style={{ height: 180, borderRadius: radii.lg, overflow: 'hidden' }}>{pathname === '/navigate' && <CameraPreview />}</View><LargeActionButton label={cameraState.ready ? 'Camera ready' : 'Prepare camera'} onPress={() => router.push('/camera')} /></>}
    <View style={styles.preflightActions}><LargeActionButton label="Start navigating" disabled={journey.busy || (route.source !== 'demo' && !cameraState.ready)} onPress={() => void start()} icon={<Text style={styles.darkIcon}>→</Text>} /><LargeActionButton label="Back to routes" onPress={() => { journey.reviewRoutes(); router.replace('/routes'); }} variant="ghost" /></View>
  </ScrollView>;

  return <View style={styles.root}>
    <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 160 }]} showsVerticalScrollIndicator={false}>
      <View style={styles.navTop}><View><Text style={styles.navStatus}>{journey.rerouting ? 'RECALCULATING ROUTE' : journey.stage === 'arrived' ? 'ARRIVAL CONFIRMED' : paused ? 'NAVIGATION PAUSED' : 'NAVIGATING'}</Text><Text style={styles.destination}>{state.destination?.name}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Open camera assist" onPress={camera} style={styles.cameraButton}><Text style={styles.cameraIcon}>▣</Text></Pressable></View>

      <View style={[styles.guidanceCard, paused && styles.guidancePaused]}>
        <View style={styles.turnIcon}><Text style={styles.turnArrow}>↑</Text></View>
        <Text style={styles.instruction} accessibilityLiveRegion="assertive">{journey.rerouting ? 'Finding a new route. Please stop.' : journey.stage === 'arrived' ? 'Arrival confirmed' : paused ? 'Guidance paused' : segment?.instruction ?? `Final waypoint near ${state.destination?.name}`}</Text>
        <Text style={styles.instructionMeta}>{paused ? 'Resume when you are ready to continue.' : `Step ${Math.min(state.stepIndex + 1, route.steps.length)} of ${route.steps.length}`}</Text>
      </View>

      <RouteMap route={route} position={journey.position} noiseCells={noise.cells} latestNoise={noise.latest} />
      {route.source !== 'demo' && <View style={{ height: 160, borderRadius: radii.lg, overflow: 'hidden' }}>{pathname === '/navigate' && <CameraPreview />}</View>}
      <View style={styles.headingOrb}><Text style={styles.orbLabel}>HEADING</Text><Text style={styles.orbValue}>{route.source === 'demo' ? 'Simulation' : 'GPS guidance'}</Text><Text style={styles.orbPulse}>◉</Text></View>

      <View style={styles.conditions}><View style={styles.conditionIcon}><Text style={styles.conditionIconText}>⌖</Text></View><View style={styles.conditionCopy}><Text style={styles.conditionTitle}>Location status</Text><Text style={styles.conditionText}>{location}</Text></View></View>
      <View style={styles.conditions}><View style={styles.conditionIcon}><Text style={styles.conditionIconText}>◎</Text></View><View style={styles.conditionCopy}><Text style={styles.conditionTitle}>Position alignment</Text><Text style={styles.conditionText}>{cameraState.alignmentStatus === 'unavailable' ? 'GPS with inertial jump filtering. Verified VPS alignment is not available.' : 'Verified visual alignment active.'}</Text></View></View>
      <View style={styles.conditions}><View style={styles.conditionIcon}><Text style={styles.conditionIconText}>≋</Text></View><View style={styles.conditionCopy}><Text style={styles.conditionTitle}>Environmental sound</Text><Text style={styles.conditionText}>{noiseMessage}</Text></View></View>

      <View style={styles.secondaryGrid}><Pressable accessibilityRole="button" accessibilityLabel="Repeat instruction" onPress={() => void speak(segment?.instruction ?? 'You are at the final waypoint.')} style={styles.smallButton}><Text style={styles.smallIcon}>↻</Text><Text style={styles.smallLabel}>Repeat</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={paused ? 'Resume navigation' : 'Pause navigation'} onPress={togglePause} style={styles.smallButton}><Text style={styles.smallIcon}>{paused ? '▶' : 'Ⅱ'}</Text><Text style={styles.smallLabel}>{paused ? 'Resume' : 'Pause'}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Measure environmental noise" onPress={() => void contributeNoise()} style={styles.smallButton}><Text style={styles.smallIcon}>≋</Text><Text style={styles.smallLabel}>Noise</Text></Pressable></View>
      {route.source === 'demo' && <><LargeActionButton label="Next simulated waypoint" onPress={next} disabled={paused || !segment} /><LargeActionButton label="Test priority alert (simulation)" onPress={() => announce('Simulation priority alert. Pause and check your surroundings.', 0)} variant="ghost" /></>}
      {journey.stage !== 'arrived' && <LargeActionButton label="Speak command" onPress={() => void journey.listen()} variant="ghost" />}
      {journey.stage !== 'arrived' && <LargeActionButton label="Confirm arrival" onPress={journey.arrive} variant="ghost" />}
      <LargeActionButton label="End navigation" onPress={stop} variant="danger" />
    </ScrollView>
    <View style={[styles.progressDock, { paddingBottom: insets.bottom + 14 }]}><View><Text style={styles.progressLabel}>REMAINING</Text><Text style={styles.progressValue}>{remaining} m</Text></View><View style={styles.progressRight}><Text style={styles.progressTime}>{Math.max(1, Math.round(remaining / 75))} min</Text><Text style={styles.progressSub}>estimated</Text></View></View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background }, container: { paddingHorizontal: spacing.lg, gap: spacing.md }, preflight: { flexGrow: 1, paddingHorizontal: spacing.lg, gap: spacing.lg }, eyebrow: { color: colors.primary, fontFamily: typography.family, fontSize: 12, fontWeight: '900', letterSpacing: 1.4 }, preflightTitle: { color: colors.text, fontFamily: typography.family, fontSize: 38, lineHeight: 45, fontWeight: '900', letterSpacing: -1 },
  summaryCard: { flexDirection: 'row', gap: 20, padding: 22, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.primary, marginTop: 16 }, routeLine: { width: 22, alignItems: 'center' }, routeDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.primary }, routeDotEnd: { backgroundColor: colors.background, borderWidth: 3, borderColor: colors.primary }, routeStem: { width: 2, flex: 1, minHeight: 62, backgroundColor: colors.primary }, summaryCopy: { flex: 1, gap: 7 }, summaryLabel: { color: colors.text, fontFamily: typography.family, fontSize: 23, fontWeight: '900' }, summaryMetric: { color: colors.primary, fontFamily: typography.family, fontSize: 20, fontWeight: '800' }, summaryHint: { color: colors.muted, fontFamily: typography.family, fontSize: 14, lineHeight: 21 }, notice: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: radii.md, backgroundColor: colors.warningSoft, borderWidth: 1, borderColor: '#72501A' }, noticeIcon: { width: 22, height: 22, borderRadius: 11, color: colors.background, backgroundColor: colors.warning, textAlign: 'center', lineHeight: 22, fontWeight: '900' }, noticeText: { flex: 1, color: colors.warning, fontFamily: typography.family, fontSize: 14, lineHeight: 20 }, preflightActions: { marginTop: 'auto', gap: 12 }, darkIcon: { color: colors.primaryText, fontSize: 21, fontWeight: '900' },
  navTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, navStatus: { color: colors.primary, fontFamily: typography.family, fontSize: 11, fontWeight: '900', letterSpacing: 1.3 }, destination: { color: colors.text, fontFamily: typography.family, fontSize: 20, fontWeight: '800', marginTop: 3 }, cameraButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, cameraIcon: { color: colors.primary, fontSize: 22 },
  guidanceCard: { backgroundColor: colors.primarySoft, borderWidth: 2, borderColor: colors.primary, borderRadius: radii.lg, padding: 22, gap: 10 }, guidancePaused: { backgroundColor: colors.warningSoft, borderColor: colors.warning }, turnIcon: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', marginBottom: 2 }, turnArrow: { color: colors.primary, fontSize: 36, lineHeight: 42, fontWeight: '400' }, instruction: { color: colors.text, fontFamily: typography.family, fontSize: 28, lineHeight: 37, fontWeight: '900' }, instructionMeta: { color: colors.muted, fontFamily: typography.family, fontSize: 14 },
  headingOrb: { width: 188, height: 188, borderRadius: 94, alignSelf: 'center', borderWidth: 3, borderColor: colors.primary, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 4, marginVertical: 8 }, orbLabel: { color: colors.muted, fontFamily: typography.family, fontSize: 12, fontWeight: '800', letterSpacing: 1.1 }, orbValue: { color: colors.text, fontFamily: typography.family, fontSize: 24, fontWeight: '900' }, orbPulse: { color: colors.primary, fontSize: 21 },
  conditions: { flexDirection: 'row', gap: 12, padding: 15, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, conditionIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }, conditionIconText: { color: colors.primary, fontSize: 21 }, conditionCopy: { flex: 1, gap: 3 }, conditionTitle: { color: colors.textSoft, fontFamily: typography.family, fontSize: 14, fontWeight: '800' }, conditionText: { color: colors.muted, fontFamily: typography.family, fontSize: 13, lineHeight: 18 },
  secondaryGrid: { flexDirection: 'row', gap: 10 }, smallButton: { flex: 1, minHeight: 76, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', gap: 4 }, smallIcon: { color: colors.primary, fontSize: 22, fontWeight: '800' }, smallLabel: { color: colors.textSoft, fontFamily: typography.family, fontSize: 12, fontWeight: '800' },
  progressDock: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 92, backgroundColor: colors.surfaceRaised, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: spacing.lg, paddingTop: 15, flexDirection: 'row', justifyContent: 'space-between' }, progressLabel: { color: colors.muted, fontFamily: typography.family, fontSize: 10, fontWeight: '900', letterSpacing: 1.1 }, progressValue: { color: colors.text, fontFamily: typography.family, fontSize: 23, fontWeight: '900' }, progressRight: { alignItems: 'flex-end' }, progressTime: { color: colors.primary, fontFamily: typography.family, fontSize: 23, fontWeight: '900' }, progressSub: { color: colors.muted, fontFamily: typography.family, fontSize: 11 },
});
