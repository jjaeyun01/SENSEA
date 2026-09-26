import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ApiError, searchPlaces, type Place } from '@/src/api/client';
import { LargeActionButton } from '@/src/components/LargeActionButton';
import { useNavigationState } from '@/src/state/NavigationState';
import { colors } from '@/src/theme';
import { speak, stopSpeaking } from '@/src/voice/speak';

export default function HomeScreen() {
  const router = useRouter();
  const [state, dispatch] = useNavigationState();
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Type a supported demo destination or choose a recent place.');
  useEffect(() => { void speak('Where would you like to go?', false); return () => { void stopSpeaking(); }; }, []);

  const findDestination = async (text = query) => {
    if (!text.trim()) { setMessage('Please enter or say a destination.'); void speak('Please enter or say a destination.'); return; }
    setBusy(true);
    try {
      const places = await searchPlaces(text, state.demoMode);
      setMatches(places);
      if (places.length === 1 && places[0]) selectPlace(places[0]);
      else if (places.length === 0) { setMessage("I couldn't find that destination. Please choose one of the supported locations."); void speak("I couldn't find that destination. Please choose one of the supported locations."); }
      else setMessage(`${places.length} matching destinations. Choose one below.`);
    } catch (error) {
      const text = error instanceof ApiError ? error.message : 'Destination search failed.';
      setMessage(text); dispatch({ type: 'ERROR', message: text }); void speak(text);
    } finally { setBusy(false); }
  };
  const selectPlace = (place: Place) => {
    dispatch({ type: 'DESTINATION', place });
    setMessage(`You selected ${place.name}. Please confirm this destination.`);
    void speak(`You selected ${place.name}. Please confirm this destination.`);
  };
  const confirm = () => { if (state.destination) router.push('/routes'); };
  const edit = () => { dispatch({ type: 'STATUS', status: 'IDLE' }); setMatches([]); setMessage('Edit the destination, then search again.'); };

  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
    <Text accessibilityRole="header" style={styles.brand}>SENSEA</Text>
    <Text accessibilityRole="header" style={styles.prompt}>Where would you like to go?</Text>
    <Text style={styles.help}>Supported demo places: Memorial Library, Campus Student Center, and Science Hall.</Text>
    <TextInput accessibilityLabel="Destination" accessibilityHint="Type a supported campus destination" style={styles.input} placeholder="Memorial Library" placeholderTextColor="#65748B" value={query} onChangeText={setQuery} onSubmitEditing={() => void findDestination()} returnKeyType="search" />
    <LargeActionButton label="Search destinations" accessibilityHint="Searches the backend for a supported place" onPress={() => void findDestination()} loading={busy} />
    <LargeActionButton label="Microphone input unavailable — use typing" accessibilityHint="Speech transcription needs a configured backend provider; typed input remains available" onPress={() => { setMessage('Speech transcription is not configured. Please type a destination.'); void speak('Speech transcription is not configured. Please type a destination.'); }} variant="secondary" />
    <View style={styles.toggleRow}><View style={styles.toggleText}><Text style={styles.toggleTitle}>Explicit demo place fallback</Text><Text style={styles.help}>Uses the labelled local destination list only; routes still require the backend.</Text></View><Switch accessibilityLabel="Demo place fallback" accessibilityHint="Uses deterministic local demo places when enabled" value={state.demoMode} onValueChange={(enabled) => dispatch({ type: 'DEMO', enabled })} /></View>
    <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text>
    {matches.map((place) => <LargeActionButton key={place.id} label={`${place.name} — ${place.verification_status} data`} accessibilityHint={place.entrance_notes} onPress={() => selectPlace(place)} variant="secondary" />)}
    {state.status === 'CONFIRM_DESTINATION' && state.destination && <View style={styles.confirm}><Text accessibilityRole="header" style={styles.confirmTitle}>Confirm {state.destination.name}</Text><Text style={styles.help}>{state.destination.entrance_notes}</Text><LargeActionButton label="Confirm destination" accessibilityHint="Requests route alternatives after confirmation" onPress={confirm} /><LargeActionButton label="Edit destination" accessibilityHint="Returns to destination entry" onPress={edit} variant="secondary" /></View>}
    {state.recentPlaces.length > 0 && <View><Text accessibilityRole="header" style={styles.section}>Recent destinations</Text>{state.recentPlaces.map((place) => <LargeActionButton key={`recent-${place.id}`} label={place.name} accessibilityHint="Selects this recent destination for confirmation" onPress={() => selectPlace(place)} variant="secondary" />)}</View>}
    <Text style={styles.safety}>Experimental information aid only. It is not a mobility or obstacle-avoidance system.</Text>
  </ScrollView></KeyboardAvoidingView>;
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.background }, container: { padding: 24, paddingTop: 56, gap: 16 }, brand: { color: colors.primary, fontSize: 20, fontWeight: '800' }, prompt: { color: colors.text, fontSize: 32, fontWeight: '800' }, help: { color: colors.muted, fontSize: 17, lineHeight: 25 }, input: { minHeight: 64, backgroundColor: 'white', color: '#111827', borderRadius: 12, paddingHorizontal: 18, fontSize: 20, borderWidth: 3, borderColor: colors.primary }, message: { color: colors.text, fontSize: 18, lineHeight: 27, minHeight: 54 }, toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, padding: 16, borderRadius: 12 }, toggleText: { flex: 1 }, toggleTitle: { color: colors.text, fontSize: 18, fontWeight: '700' }, confirm: { gap: 12, padding: 18, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.primary }, confirmTitle: { color: colors.text, fontSize: 24, fontWeight: '800' }, section: { color: colors.text, fontSize: 22, fontWeight: '700', marginVertical: 12 }, safety: { color: colors.warning, fontSize: 15, lineHeight: 23 } });
