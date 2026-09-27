import { useEffect } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppHeader } from '@/src/components/AppHeader';
import { LargeActionButton } from '@/src/components/LargeActionButton';
import { CameraPreview, useCamera } from '@/src/camera/CameraProvider';
import { useJourney } from '@/src/navigation/JourneyProvider';
import { colors, radii, spacing, typography } from '@/src/theme';
export default function CameraScreen() {
  const router = useRouter(); const pathname = usePathname(); const insets = useSafeAreaInsets(); const camera = useCamera(); const journey = useJourney();
  const busy = camera.phase === 'opening' || camera.phase === 'closing';
  useEffect(() => { journey.say('Hold your phone upright, facing forward. Camera frames are analyzed on this device and are not recorded.'); }, []);
  const back = () => { if (journey.selected) router.replace('/navigate'); else { camera.close(); router.replace('/'); } };
  return <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
    <View style={styles.headerWrap}><AppHeader title="Camera assist" eyebrow="ON-DEVICE OBSERVATIONS" onBack={back} /></View>
    <View style={styles.cameraFrame}>
      {pathname === '/camera' && <CameraPreview />}
      <View pointerEvents="none" style={[styles.corner, styles.topLeft]} /><View pointerEvents="none" style={[styles.corner, styles.topRight]} /><View pointerEvents="none" style={[styles.corner, styles.bottomLeft]} /><View pointerEvents="none" style={[styles.corner, styles.bottomRight]} />
      <View pointerEvents="none" style={styles.cameraBadge}><View style={styles.liveDot} /><Text style={styles.cameraBadgeText}>{busy ? 'PREPARING' : camera.ready ? 'CAMERA READY' : 'CAMERA OFF / WAITING'}</Text></View>
    </View>
    <View style={[styles.panel, { paddingBottom: insets.bottom + 22 }]}>
      <View style={styles.resultRow}><View style={styles.resultIcon}><Text style={styles.resultIconText}>◎</Text></View><Text accessibilityLiveRegion="polite" style={styles.resultText}>{camera.message}</Text></View>
      <LargeActionButton label={camera.phase === 'live' ? 'Describe what’s ahead' : 'Enable camera analysis'} onPress={() => { if (camera.phase === 'live') camera.repeat(); else void camera.open(); }} loading={busy} icon={<Text style={styles.captureIcon}>●</Text>} />
      <LargeActionButton label="Return to navigation" onPress={back} variant="ghost" />
      <LargeActionButton label="Stop camera" onPress={camera.close} variant="ghost" />
      {camera.phase === 'closed' && <LargeActionButton label="Camera permission settings" onPress={() => void Linking.openSettings()} variant="ghost" />}
      <Text style={styles.warning}>Frames stay on this device. Observations do not establish distance, clear paths, safe crossings, or verified camera positioning.</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background }, headerWrap: { paddingHorizontal: spacing.lg }, cameraFrame: { flex: 1, minHeight: 300, marginHorizontal: spacing.lg, borderRadius: radii.lg, overflow: 'hidden', borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.surface }, camera: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  corner: { position: 'absolute', width: 32, height: 32, borderColor: colors.primary, borderWidth: 4 }, topLeft: { top: 16, left: 16, borderRightWidth: 0, borderBottomWidth: 0 }, topRight: { top: 16, right: 16, borderLeftWidth: 0, borderBottomWidth: 0 }, bottomLeft: { bottom: 16, left: 16, borderRightWidth: 0, borderTopWidth: 0 }, bottomRight: { bottom: 16, right: 16, borderLeftWidth: 0, borderTopWidth: 0 }, cameraBadge: { position: 'absolute', top: 18, alignSelf: 'center', borderRadius: radii.pill, backgroundColor: '#07100FCC', paddingHorizontal: 11, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 7 }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary }, cameraBadgeText: { color: colors.text, fontFamily: typography.family, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  panel: { paddingHorizontal: spacing.lg, paddingTop: 18, gap: 11, backgroundColor: colors.background }, resultRow: { minHeight: 74, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }, resultIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }, resultIconText: { color: colors.primary, fontSize: 21 }, resultText: { flex: 1, color: colors.textSoft, fontFamily: typography.family, fontSize: 15, lineHeight: 21 }, captureIcon: { color: colors.primaryText, fontSize: 17 }, warning: { color: colors.mutedDark, fontFamily: typography.family, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  center: { flex: 1, justifyContent: 'center', padding: 28, gap: 16, backgroundColor: colors.background }, permissionIcon: { width: 74, height: 74, borderRadius: 37, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }, permissionIconText: { color: colors.primary, fontSize: 32 }, centerTitle: { color: colors.text, fontFamily: typography.family, fontSize: 30, fontWeight: '900', textAlign: 'center' }, centerText: { color: colors.muted, fontFamily: typography.family, fontSize: 16, lineHeight: 24, textAlign: 'center' }, permissionActions: { marginTop: 18, gap: 11 },
});
