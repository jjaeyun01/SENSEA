import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { LargeActionButton } from '@/src/components/LargeActionButton';
import { submitNoiseMeasurement } from '@/src/api/client';
import { getCurrentLocation } from '@/src/navigation/location';
import { noiseMeter, requestNoisePermission } from '@/src/noise/noiseMeter';
import { useNavigationState } from '@/src/state/NavigationState';
import { colors } from '@/src/theme';
import { speak, stopSpeaking } from '@/src/voice/speak';

export default function NavigateScreen() {
  const router = useRouter(); const [state, dispatch] = useNavigationState();
  const [started, setStarted] = useState(false); const [paused, setPaused] = useState(false);
  const [location, setLocation] = useState('Demo simulation selected. Live location has not been requested.');
  const [noiseMessage, setNoiseMessage] = useState('No microphone permission or noise sample has been requested.');
  const route = state.selectedRoute; const segment = route?.segments[state.stepIndex];
  useEffect(() => { if (!route) router.replace('/routes'); return () => { void stopSpeaking(); }; }, [route]);
  if (!route) return null;

  const start = async () => {
    setStarted(true); dispatch({ type: 'STATUS', status: 'NAVIGATING' });
    const result = await getCurrentLocation();
    if (!result.ok) setLocation(`${result.reason} Demo simulation is active.`);
    else if (result.accuracyMeters !== null && result.accuracyMeters > 30) setLocation(`Live location accuracy is about ${Math.round(result.accuracyMeters)} meters, too low for a precise turn instruction. Demo simulation is active.`);
    else setLocation(`Live location available with reported accuracy ${result.accuracyMeters === null ? 'unknown' : `${Math.round(result.accuracyMeters)} meters`}; this screen still advances only by demo simulation.`);
    if (segment) void speak(`Demo simulation. ${segment.instruction}`);
  };
  const next = () => {
    if (paused || !segment) return;
    const nextIndex = state.stepIndex + 1;
    if (nextIndex >= route.segments.length) { void speak(`You have reached the final demo waypoint near ${state.destination?.name}. This does not confirm an accessible entrance or that it is safe to proceed.`); return; }
    dispatch({ type: 'STEP', index: nextIndex });
    const nextSegment = route.segments[nextIndex]; if (nextSegment) void speak(nextSegment.instruction);
  };
  const togglePause = () => { const value = !paused; setPaused(value); dispatch({ type: 'STATUS', status: value ? 'PAUSED' : 'NAVIGATING' }); void speak(value ? 'Navigation paused.' : `Navigation resumed. ${segment?.instruction ?? ''}`); };
  const stop = () => { void stopSpeaking(); dispatch({ type: 'RESET' }); router.replace('/'); };
  const camera = () => { dispatch({ type: 'STATUS', status: 'CAMERA_ASSIST' }); void speak('Please stop walking before using camera assistance.'); router.push('/camera'); };
  const contributeNoise = async () => {
    if (!segment) return;
    const permission = await requestNoisePermission(); setNoiseMessage(permission.message);
    if (!permission.granted) { void speak(permission.message); return; }
    const reading = await noiseMeter.measure(segment.edge_id);
    try {
      await submitNoiseMeasurement({ edge_id: segment.edge_id, relative_noise: reading.relativeNoise, consent: true });
      const text = `Demo-mode relative noise summary ${reading.relativeNoise} submitted for this segment. This is deterministic demo data, not a live decibel measurement. No raw audio was stored.`;
      setNoiseMessage(text); void speak(text);
    } catch {
      const text = 'The noise summary could not be submitted. No raw audio was stored.'; setNoiseMessage(text); void speak(text);
    }
  };

  return <ScrollView style={styles.root} contentContainerStyle={styles.container}><Text accessibilityRole="header" style={styles.title}>{state.destination?.name}</Text><View accessibilityRole="alert" style={styles.banner}><Text style={styles.warning}>Demo simulation — not live turn-by-turn navigation. Verified demo graph segments do not guarantee real-world conditions.</Text></View>
    {!started ? <View style={styles.card}><Text style={styles.instruction}>{route.label}, {route.distance_m} meters.</Text><LargeActionButton label="Start navigation" accessibilityHint="Requests location permission and starts the demo simulation" onPress={() => void start()} /><LargeActionButton label="Back to routes" onPress={() => router.back()} variant="secondary" /></View> : <>
      <View style={styles.card}><Text style={styles.label}>Current waypoint instruction</Text><Text accessibilityLiveRegion="assertive" style={styles.instruction}>{segment?.instruction ?? `Final demo waypoint near ${state.destination?.name}.`}</Text><Text style={styles.text}>Waypoint {Math.min(state.stepIndex + 1, route.segments.length)} of {route.segments.length}</Text></View>
      <View style={styles.location}><Text style={styles.label}>Location mode</Text><Text accessibilityLiveRegion="polite" style={styles.text}>{location}</Text></View>
      <View style={styles.location}><Text style={styles.label}>Opt-in relative noise</Text><Text accessibilityLiveRegion="polite" style={styles.text}>{noiseMessage}</Text></View>
      <LargeActionButton label="Next simulated waypoint" accessibilityHint="Advances the deterministic demo one waypoint" onPress={next} disabled={paused || !segment} />
      <LargeActionButton label="Repeat instruction" onPress={() => void speak(segment?.instruction ?? 'You are at the final demo waypoint.')} variant="secondary" />
      <LargeActionButton label={paused ? 'Resume navigation' : 'Pause navigation'} onPress={togglePause} variant="secondary" />
      <LargeActionButton label="Describe surroundings" accessibilityHint="Asks you to stop, then opens the still-image camera assistant" onPress={camera} variant="secondary" />
      <LargeActionButton label="Contribute demo relative noise summary" accessibilityHint="Requests microphone permission for an explicitly labelled deterministic demo adapter and uploads only a summary" onPress={() => void contributeNoise()} variant="secondary" />
      <LargeActionButton label="Stop navigation" accessibilityHint="Stops guidance and returns home" onPress={stop} variant="danger" />
    </>}</ScrollView>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.background }, container: { padding: 24, gap: 14, paddingBottom: 48 }, title: { color: colors.text, fontSize: 30, fontWeight: '800' }, banner: { backgroundColor: '#4A3410', borderRadius: 12, padding: 15, borderWidth: 1, borderColor: colors.warning }, warning: { color: colors.warning, fontSize: 16, lineHeight: 24 }, card: { backgroundColor: colors.surface, borderRadius: 18, padding: 20, gap: 14, borderWidth: 2, borderColor: colors.primary }, label: { color: colors.primary, fontSize: 16, fontWeight: '700' }, instruction: { color: colors.text, fontSize: 25, lineHeight: 36, fontWeight: '700' }, text: { color: colors.text, fontSize: 17, lineHeight: 25 }, location: { backgroundColor: colors.surfaceRaised, borderRadius: 12, padding: 16, gap: 8 } });
