import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { useNoiseMonitor } from '@/src/noise/NoiseMonitorProvider';
import { colors, radii, typography } from '@/src/theme';

const bandLabels = { quiet: 'Quiet', moderate: 'Moderate', loud: 'Loud' } as const;

export function LiveNoiseMeter() {
  const noise = useNoiseMonitor();
  const reading = !noise.active || noise.dbfs === null ? '—' : `${Math.round(noise.dbfs)} dBFS`;
  const status = noise.permission === 'requesting' ? 'REQUESTING ACCESS' : noise.active ? 'LIVE' : noise.permission === 'denied' ? 'PERMISSION OFF' : noise.enabled ? 'PAUSED' : 'OFF';
  return <View accessible accessibilityRole="summary" accessibilityLabel={`Environmental sound meter. ${reading}. ${noise.band ? bandLabels[noise.band] : status}.`} style={styles.card}>
    <View style={styles.header}>
      <View style={styles.titleRow}><View style={[styles.liveDot, noise.active && styles.liveDotActive]} /><Text style={styles.title}>Environmental sound</Text></View>
      <View style={[styles.statusBadge, noise.active && styles.statusBadgeActive]}><Text style={[styles.statusText, noise.active && styles.statusTextActive]}>{status}</Text></View>
    </View>
    <View style={styles.readingRow}>
      <Text style={styles.reading}>{reading}</Text>
      <Text style={styles.band}>{noise.active && noise.band ? bandLabels[noise.band] : 'Waiting for reading'}</Text>
    </View>
    <View style={styles.track}><View style={[styles.fill, { width: `${noise.active ? Math.round(noise.progress * 100) : 0}%` }, noise.band === 'moderate' && styles.fillModerate, noise.band === 'loud' && styles.fillLoud]} /></View>
    <Text style={styles.note}>Device-relative level, not calibrated dB SPL. Audio is processed on-device and is not stored or uploaded.</Text>
    {noise.permission === 'denied' && <Pressable accessibilityRole="button" onPress={() => void (noise.canAskAgain ? noise.requestPermission() : Linking.openSettings())} style={styles.permissionButton}><Text style={styles.permissionButtonText}>{noise.canAskAgain ? 'Allow microphone access' : 'Open system settings'}</Text></Pressable>}
    {!!noise.error && <Text accessibilityRole="alert" style={styles.error}>{noise.error}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  card: { padding: 17, gap: 11, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.mutedDark }, liveDotActive: { backgroundColor: colors.primary }, title: { color: colors.text, fontFamily: typography.family, fontSize: 16, fontWeight: '900' },
  statusBadge: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: colors.backgroundSoft }, statusBadgeActive: { backgroundColor: colors.primarySoft }, statusText: { color: colors.muted, fontFamily: typography.family, fontSize: 8, fontWeight: '900', letterSpacing: 0.7 }, statusTextActive: { color: colors.primary },
  readingRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }, reading: { color: colors.text, fontFamily: typography.family, fontSize: 31, fontWeight: '900', letterSpacing: -0.8 }, band: { color: colors.muted, fontFamily: typography.family, fontSize: 13, fontWeight: '800' },
  track: { height: 9, borderRadius: 5, overflow: 'hidden', backgroundColor: colors.surfaceHighlight }, fill: { height: '100%', borderRadius: 5, backgroundColor: '#24C875' }, fillModerate: { backgroundColor: '#FFAA17' }, fillLoud: { backgroundColor: '#FF514B' },
  note: { color: colors.mutedDark, fontFamily: typography.family, fontSize: 10, lineHeight: 15 }, permissionButton: { minHeight: 42, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft }, permissionButtonText: { color: colors.primary, fontFamily: typography.family, fontSize: 12, fontWeight: '900' }, error: { color: colors.danger, fontFamily: typography.family, fontSize: 11, lineHeight: 16 },
});
