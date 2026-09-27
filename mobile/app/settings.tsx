import notices from '../assets/third-party-notices.json';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader } from '@/src/components/AppHeader';
import { LargeActionButton } from '@/src/components/LargeActionButton';
import { useJourney } from '@/src/navigation/JourneyProvider';
import { colors, radii, spacing, typography } from '@/src/theme';
import { useAuth } from '@/src/auth/AuthProvider';
import { useNoise } from '@/src/noise/NoiseProvider';
export default function SettingsScreen() {
  const router = useRouter(); const insets = useSafeAreaInsets(); const journey = useJourney();
  const auth = useAuth();
  const noise = useNoise();
  const [licenses, setLicenses] = useState(false);
  const [saved, setSaved] = useState(false);
  const recording = () => { void journey.toggleRecording().then(() => setSaved(true)).catch(() => journey.say('Could not save recording preference.')); };
  const changeNoiseConsent = (enabled: boolean) => {
    if (!auth.user) { router.push('/auth'); return; }
    if (!enabled) { void noise.setConsent(false).catch(error => journey.say(error instanceof Error ? error.message : 'Could not stop noise contribution.')); return; }
    Alert.alert(
      'Contribute to the noise map?',
      'During active navigation, SENSEA will use the microphone and foreground location for five-second samples. Audio is processed on this device and immediately deleted. Only a relative sound number, time, accuracy, and a roughly 30–45 metre grid cell are uploaded. This is optional and can be stopped at any time.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Allow and continue', onPress: () => void noise.setConsent(true).catch(error => journey.say(error instanceof Error ? error.message : 'Could not enable noise contribution.')) },
      ],
    );
  };
  return <ScrollView style={styles.root} contentContainerStyle={[styles.container, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 30 }]} showsVerticalScrollIndicator={false}>
    <AppHeader title="Settings" eyebrow="GUIDANCE PREFERENCES" onBack={() => router.back()} />
    <View style={styles.accountCard}><View style={styles.settingCopy}><Text style={styles.settingTitle}>{auth.user ? auth.profile?.name || 'Your account' : 'SENSEA account'}</Text><Text style={styles.settingDescription}>{auth.user ? 'Profile, saved places, favorites, recent destinations, and route preferences are synced.' : 'Sign in to sync your personal data and route preferences.'}</Text></View><LargeActionButton label={auth.user ? 'Open account' : 'Sign in or sign up'} onPress={() => router.push(auth.user ? '/account' : '/auth')} variant="secondary" /></View>
    <View style={styles.list}>
      <Setting title="Voice feedback" description="Required for guidance. Uses the screen reader when enabled." value={true} onChange={() => {}} disabled />
      <Setting title="Haptic feedback" description="Required alongside spoken guidance. Device support varies." value={true} onChange={() => {}} disabled />
      <Setting title="Prefer flat routes" description="Unavailable until slopes and stairs are verified." value={false} onChange={() => {}} disabled />
      <Setting title="Contribute to noise map" description={`${noise.status} Foreground navigation only; no audio is uploaded or retained.`} value={noise.consentEnabled} onChange={changeNoiseConsent} disabled={!auth.user} />
      <Setting title="Interaction records" description="Commands and actions stay on this device. Maximum 2,000 events; entries older than 7 days are removed on use. No audio, video or GPS trail." value={journey.recording} onChange={recording} />
    </View>
    {saved && <Text accessibilityLiveRegion="polite" style={styles.saved}>✓ Recording preference saved on this device</Text>}
    <LargeActionButton label="Check records" onPress={() => void journey.checkRecords().catch(() => journey.say('Records unavailable.'))} variant="ghost" />
    <LargeActionButton label="Delete interaction records" onPress={() => void journey.deleteRecords().catch(() => journey.say('Could not delete records.'))} variant="danger" />
    {auth.user && <LargeActionButton label="Delete my noise measurements" onPress={() => void noise.deleteMyMeasurements().then(() => journey.say('Your contributed noise measurements were deleted.')).catch(() => journey.say('Could not delete noise measurements.'))} variant="danger" />}
    <LargeActionButton label={licenses ? "Hide open-source notices" : "Open-source notices"} onPress={() => setLicenses(!licenses)} variant="ghost" />
    {licenses && <Text style={styles.settingDescription}>{notices.text}</Text>}
    <Text style={styles.settingDescription}>Speech recognition may use Apple or Google services. Search terms go to UW. Current position and destination go to Google for routing. Camera frames and noise audio are processed on-device. Noise-map uploads contain only coarse-grid numeric measurements.</Text>
  </ScrollView>;
}

function Setting({ title, description, value, onChange, children, disabled = false }: { title: string; description: string; value: boolean; onChange: (value: boolean) => void; children?: React.ReactNode; disabled?: boolean }) {
  return <View style={styles.card}><View style={styles.settingTop}><View style={styles.settingCopy}><Text style={styles.settingTitle}>{title}</Text><Text style={styles.settingDescription}>{description}</Text></View><Switch disabled={disabled} accessibilityLabel={title} value={value} onValueChange={onChange} trackColor={{ false: colors.surfaceHighlight, true: colors.primary }} thumbColor={colors.background} /></View>{children}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background }, container: { paddingHorizontal: spacing.lg, gap: spacing.lg }, accountCard: { borderRadius: radii.lg, padding: 18, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary, gap: 15 }, list: { gap: 14 }, card: { borderRadius: radii.lg, padding: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 17 }, settingTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, settingCopy: { flex: 1, gap: 5 }, settingTitle: { color: colors.text, fontFamily: typography.family, fontSize: 19, fontWeight: '900' }, settingDescription: { color: colors.muted, fontFamily: typography.family, fontSize: 14, lineHeight: 20 }, speedRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, speedText: { color: colors.muted, fontFamily: typography.family, fontSize: 13, fontWeight: '700' }, speedFast: { color: colors.primary }, track: { flex: 1, height: 7, borderRadius: 4, backgroundColor: colors.surfaceHighlight, justifyContent: 'center' }, trackFill: { position: 'absolute', left: 0, width: '54%', height: 7, borderRadius: 4, backgroundColor: colors.primary }, trackThumb: { position: 'absolute', left: '51%', width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary }, saved: { color: colors.primary, fontFamily: typography.family, fontSize: 14, textAlign: 'center', fontWeight: '800' }, check: { color: colors.primaryText, fontSize: 19, fontWeight: '900' },
});
