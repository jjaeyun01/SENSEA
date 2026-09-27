import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader } from '@/src/components/AppHeader';
import { LargeActionButton } from '@/src/components/LargeActionButton';
import { colors, radii, spacing, typography } from '@/src/theme';

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [voice, setVoice] = useState(true);
  const [haptics, setHaptics] = useState(true);
  const [flatRoutes, setFlatRoutes] = useState(true);
  const [noise, setNoise] = useState(true);
  const [saved, setSaved] = useState(false);

  return <ScrollView style={styles.root} contentContainerStyle={[styles.container, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 30 }]} showsVerticalScrollIndicator={false}>
    <AppHeader title="Settings" eyebrow="GUIDANCE PREFERENCES" onBack={() => router.back()} />
    <View style={styles.list}>
      <Setting title="Voice feedback" description="Reads navigation cues aloud automatically." value={voice} onChange={setVoice}><View style={styles.speedRow}><Text style={styles.speedText}>Slow</Text><View style={styles.track}><View style={styles.trackFill} /><View style={styles.trackThumb} /></View><Text style={[styles.speedText, styles.speedFast]}>Fast</Text></View></Setting>
      <Setting title="Haptic feedback" description="Vibrates the device for upcoming turns and alerts." value={haptics} onChange={setHaptics} />
      <Setting title="Prefer flat routes" description="Prioritizes routes without stairs or steep inclines." value={flatRoutes} onChange={setFlatRoutes} />
      <Setting title="Noise awareness" description="Includes recent environmental sound data when available." value={noise} onChange={setNoise} />
    </View>
    {saved && <Text accessibilityLiveRegion="polite" style={styles.saved}>✓ Preferences saved on this device</Text>}
    <LargeActionButton label="Save changes" onPress={() => setSaved(true)} icon={<Text style={styles.check}>✓</Text>} />
  </ScrollView>;
}

function Setting({ title, description, value, onChange, children }: { title: string; description: string; value: boolean; onChange: (value: boolean) => void; children?: React.ReactNode }) {
  return <View style={styles.card}><View style={styles.settingTop}><View style={styles.settingCopy}><Text style={styles.settingTitle}>{title}</Text><Text style={styles.settingDescription}>{description}</Text></View><Switch accessibilityLabel={title} value={value} onValueChange={onChange} trackColor={{ false: colors.surfaceHighlight, true: colors.primary }} thumbColor={colors.background} /></View>{children}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background }, container: { paddingHorizontal: spacing.lg, gap: spacing.lg }, list: { gap: 14 }, card: { borderRadius: radii.lg, padding: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 17 }, settingTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, settingCopy: { flex: 1, gap: 5 }, settingTitle: { color: colors.text, fontFamily: typography.family, fontSize: 19, fontWeight: '900' }, settingDescription: { color: colors.muted, fontFamily: typography.family, fontSize: 14, lineHeight: 20 }, speedRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, speedText: { color: colors.muted, fontFamily: typography.family, fontSize: 13, fontWeight: '700' }, speedFast: { color: colors.primary }, track: { flex: 1, height: 7, borderRadius: 4, backgroundColor: colors.surfaceHighlight, justifyContent: 'center' }, trackFill: { position: 'absolute', left: 0, width: '54%', height: 7, borderRadius: 4, backgroundColor: colors.primary }, trackThumb: { position: 'absolute', left: '51%', width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary }, saved: { color: colors.primary, fontFamily: typography.family, fontSize: 14, textAlign: 'center', fontWeight: '800' }, check: { color: colors.primaryText, fontSize: 19, fontWeight: '900' },
});
