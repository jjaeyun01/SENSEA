import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, searchPlaces, type Place } from '@/src/api/client';
import { BrandMark } from '@/src/components/BrandMark';
import { LargeActionButton } from '@/src/components/LargeActionButton';
import { useNavigationState } from '@/src/state/NavigationState';
import { colors, radii, spacing, typography } from '@/src/theme';
import { speak, stopSpeaking } from '@/src/voice/speak';

const SUGGESTIONS = [
  { name: 'Memorial Library', meta: '450 m · Campus North', icon: '▦' },
  { name: 'Campus Student Center', meta: '220 m · Campus Center', icon: '◎' },
];

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [state, dispatch] = useNavigationState();
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Type a destination or choose a recent place.');

  useEffect(() => { void speak('Where would you like to go?', false); return () => { void stopSpeaking(); }; }, []);

  const selectPlace = (place: Place) => {
    dispatch({ type: 'DESTINATION', place });
    setMessage(`You selected ${place.name}. Please confirm this destination.`);
    void speak(`You selected ${place.name}. Please confirm this destination.`);
  };

  const findDestination = async (text = query) => {
    if (!text.trim()) { setMessage('Please enter a destination.'); void speak('Please enter a destination.'); return; }
    setQuery(text); setBusy(true); setMatches([]);
    try {
      const places = await searchPlaces(text, state.demoMode);
      setMatches(places);
      if (places.length === 1 && places[0]) selectPlace(places[0]);
      else if (places.length === 0) { setMessage("I couldn't find that destination. Try one of the supported campus places."); void speak("I couldn't find that destination."); }
      else setMessage(`${places.length} destinations found.`);
    } catch (error) {
      const text = error instanceof ApiError ? error.message : 'Destination search failed.';
      setMessage(text); dispatch({ type: 'ERROR', message: text }); void speak(text);
    } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 110 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.topbar}>
          <BrandMark compact />
          <Pressable accessibilityRole="button" accessibilityLabel="Open settings" onPress={() => router.push('/settings')} style={styles.settingsButton}><Text style={styles.settingsIcon}>⚙</Text></Pressable>
        </View>

        <View style={styles.hero}>
          <Text style={styles.kicker}>GOOD EVENING, MICHELLE</Text>
          <Text accessibilityRole="header" style={styles.prompt}>Where would you like to go?</Text>
          <Text style={styles.subtitle}>Speak or type a destination. SENSEA will compare verified pedestrian routes for you.</Text>
        </View>

        <Pressable accessibilityRole="button" accessibilityLabel="Start voice destination input" accessibilityHint="Speech input is not configured in this prototype" onPress={() => { setMessage('Voice input is not configured yet. Please type a destination below.'); void speak('Please type a destination below.'); }} style={({ pressed }) => [styles.voiceOrb, pressed && styles.voiceOrbPressed]}>
          <View style={styles.orbGlow} />
          <View style={styles.micHandle}><Text style={styles.mic}>●</Text></View>
          <Text style={styles.orbTitle}>Tap to speak</Text>
          <Text style={styles.orbHint}>“Take me to the library”</Text>
        </Pressable>

        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput accessibilityLabel="Destination" accessibilityHint="Type a campus destination" style={styles.input} placeholder="Type a destination" placeholderTextColor={colors.mutedDark} value={query} onChangeText={setQuery} onSubmitEditing={() => void findDestination()} returnKeyType="search" />
          <Pressable accessibilityRole="button" accessibilityLabel="Search destinations" disabled={busy} onPress={() => void findDestination()} style={styles.searchSubmit}><Text style={styles.searchArrow}>{busy ? '…' : '→'}</Text></Pressable>
        </View>

        <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text>
        {matches.length > 1 && <View style={styles.results}>{matches.map((place) => <DestinationCard key={place.id} title={place.name} meta={place.entrance_notes} icon="⌖" onPress={() => selectPlace(place)} />)}</View>}

        {state.status === 'CONFIRM_DESTINATION' && state.destination ? (
          <View style={styles.confirmCard}>
            <View style={styles.confirmIcon}><Text style={styles.confirmIconText}>▦</Text></View>
            <View style={styles.confirmCopy}><Text style={styles.cardLabel}>DESTINATION</Text><Text style={styles.confirmTitle}>{state.destination.name}</Text><Text style={styles.cardMeta}>{state.destination.entrance_notes}</Text></View>
            <LargeActionButton label="Find routes" onPress={() => router.push('/routes')} icon={<Text style={styles.buttonIcon}>⌖</Text>} />
            <LargeActionButton label="Change destination" onPress={() => { dispatch({ type: 'STATUS', status: 'IDLE' }); setMatches([]); }} variant="ghost" />
          </View>
        ) : (
          <View style={styles.section}>
            <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Recent destinations</Text><Text style={styles.sectionMeta}>VERIFIED CAMPUS</Text></View>
            {SUGGESTIONS.map((item) => <DestinationCard key={item.name} title={item.name} meta={item.meta} icon={item.icon} onPress={() => void findDestination(item.name)} />)}
          </View>
        )}

        <View style={styles.demoRow}>
          <View style={styles.demoCopy}><Text style={styles.demoTitle}>Demo destination data</Text><Text style={styles.demoText}>Use the local labeled places when the backend is offline.</Text></View>
          <Switch accessibilityLabel="Demo destination data" value={state.demoMode} onValueChange={(enabled) => dispatch({ type: 'DEMO', enabled })} trackColor={{ false: colors.surfaceHighlight, true: colors.primary }} thumbColor={colors.background} />
        </View>
        <Text style={styles.safety}>SENSEA is an experimental information aid, not a mobility or obstacle-avoidance system.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function DestinationCard({ title, meta, icon, onPress }: { title: string; meta: string; icon: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}, ${meta}`} onPress={onPress} style={({ pressed }) => [styles.destinationCard, pressed && styles.cardPressed]}><View style={styles.placeIcon}><Text style={styles.placeIconText}>{icon}</Text></View><View style={styles.placeCopy}><Text style={styles.placeTitle}>{title}</Text><Text style={styles.cardMeta} numberOfLines={2}>{meta}</Text></View><Text style={styles.chevron}>›</Text></Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background }, container: { paddingHorizontal: spacing.lg, gap: spacing.md },
  topbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, settingsButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, settingsIcon: { color: colors.muted, fontSize: 23 },
  hero: { paddingTop: spacing.md, gap: 7 }, kicker: { color: colors.primary, fontFamily: typography.family, fontSize: 12, fontWeight: '800', letterSpacing: 1.4 }, prompt: { color: colors.text, fontFamily: typography.family, fontSize: 36, lineHeight: 43, fontWeight: '900', letterSpacing: -1.1 }, subtitle: { color: colors.muted, fontFamily: typography.family, fontSize: 16, lineHeight: 24 },
  voiceOrb: { width: 220, height: 220, borderRadius: 110, alignSelf: 'center', marginVertical: 12, backgroundColor: colors.primarySoft, borderWidth: 3, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', overflow: 'visible' }, voiceOrbPressed: { transform: [{ scale: 0.98 }], backgroundColor: '#005249' }, orbGlow: { position: 'absolute', width: 232, height: 232, borderRadius: 116, borderWidth: 1, borderColor: '#0A756B', opacity: 0.7 }, micHandle: { width: 44, height: 58, borderWidth: 3, borderColor: colors.primary, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 13 }, mic: { color: colors.primary, fontSize: 22 }, orbTitle: { color: colors.text, fontFamily: typography.family, fontSize: 21, fontWeight: '800' }, orbHint: { color: colors.primary, fontFamily: typography.family, fontSize: 13, marginTop: 4 },
  searchBox: { minHeight: 62, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingLeft: 16, paddingRight: 7, flexDirection: 'row', alignItems: 'center', gap: 10 }, searchIcon: { color: colors.muted, fontSize: 28 }, input: { flex: 1, color: colors.text, fontFamily: typography.family, fontSize: 17, minHeight: 58 }, searchSubmit: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }, searchArrow: { color: colors.primaryText, fontSize: 25, fontWeight: '800' }, message: { color: colors.muted, fontFamily: typography.family, fontSize: 14, lineHeight: 20, minHeight: 20 },
  section: { gap: 11, paddingTop: 5 }, sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, sectionTitle: { color: colors.textSoft, fontFamily: typography.family, fontSize: 16, fontWeight: '800' }, sectionMeta: { color: colors.mutedDark, fontFamily: typography.family, fontSize: 10, fontWeight: '800', letterSpacing: 1 }, results: { gap: 10 },
  destinationCard: { minHeight: 82, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 13 }, cardPressed: { borderColor: colors.primary, backgroundColor: colors.surfaceRaised }, placeIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }, placeIconText: { color: colors.primary, fontSize: 23, fontWeight: '700' }, placeCopy: { flex: 1, gap: 3 }, placeTitle: { color: colors.text, fontFamily: typography.family, fontSize: 17, fontWeight: '800' }, cardMeta: { color: colors.muted, fontFamily: typography.family, fontSize: 14, lineHeight: 19 }, chevron: { color: colors.mutedDark, fontSize: 30 },
  confirmCard: { borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.primary, padding: 20, gap: 13 }, confirmIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }, confirmIconText: { color: colors.primary, fontSize: 24 }, confirmCopy: { gap: 4, marginBottom: 5 }, cardLabel: { color: colors.primary, fontFamily: typography.family, fontSize: 11, letterSpacing: 1.2, fontWeight: '900' }, confirmTitle: { color: colors.text, fontFamily: typography.family, fontSize: 25, fontWeight: '900' }, buttonIcon: { color: colors.primaryText, fontSize: 20 },
  demoRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: radii.md, backgroundColor: colors.backgroundSoft, borderWidth: 1, borderColor: colors.border }, demoCopy: { flex: 1, gap: 3 }, demoTitle: { color: colors.textSoft, fontFamily: typography.family, fontSize: 15, fontWeight: '800' }, demoText: { color: colors.muted, fontFamily: typography.family, fontSize: 12, lineHeight: 17 }, safety: { color: colors.mutedDark, fontFamily: typography.family, fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
