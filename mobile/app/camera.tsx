import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, describeImage } from '@/src/api/client';
import { AppHeader } from '@/src/components/AppHeader';
import { LargeActionButton } from '@/src/components/LargeActionButton';
import { useNavigationState } from '@/src/state/NavigationState';
import { colors, radii, spacing, typography } from '@/src/theme';
import { speak, stopSpeaking } from '@/src/voice/speak';

export default function CameraScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [state, dispatch] = useNavigationState();
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Point the camera toward a landmark, sign or entrance.');
  useEffect(() => { void speak('Please stop walking before using camera assistance.'); return () => { void stopSpeaking(); }; }, []);
  const back = () => { dispatch({ type: 'STATUS', status: 'NAVIGATING' }); router.back(); };
  const capture = async () => {
    if (!camera.current) return;
    setBusy(true); setMessage('Analyzing one still image…');
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.55, skipProcessing: false });
      if (!photo?.uri) throw new Error('No image was captured.');
      const result = await describeImage(photo.uri, state.destination?.name);
      const text = `${result.uncertainty >= 0.5 ? "I'm not certain. " : ''}${result.description}`; setMessage(text); void speak(text);
    } catch (error) { const text = error instanceof ApiError ? error.message : 'The image could not be described. You can retry or return to navigation.'; setMessage(text); void speak(text); }
    finally { setBusy(false); }
  };

  if (!permission) return <View style={styles.center}><Text style={styles.centerTitle}>Checking camera access</Text><Text style={styles.centerText}>This should only take a moment.</Text><LargeActionButton label="Return to navigation" onPress={back} variant="ghost" /></View>;
  if (!permission.granted) return <View style={[styles.center, { paddingTop: insets.top + 30 }]}><View style={styles.permissionIcon}><Text style={styles.permissionIconText}>▣</Text></View><Text accessibilityRole="header" style={styles.centerTitle}>Use camera assist?</Text><Text style={styles.centerText}>SENSEA captures one image only when you ask. It does not store a gallery or record continuous video.</Text><View style={styles.permissionActions}><LargeActionButton label="Allow camera access" onPress={() => void requestPermission()} /><LargeActionButton label="Not now" onPress={back} variant="ghost" /></View></View>;

  return <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
    <View style={styles.headerWrap}><AppHeader title="Camera assist" eyebrow="STOP WALKING BEFORE USE" onBack={back} /></View>
    <View style={styles.cameraFrame}>
      <CameraView ref={camera} facing="back" style={styles.camera} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      <View pointerEvents="none" style={[styles.corner, styles.topLeft]} /><View pointerEvents="none" style={[styles.corner, styles.topRight]} /><View pointerEvents="none" style={[styles.corner, styles.bottomLeft]} /><View pointerEvents="none" style={[styles.corner, styles.bottomRight]} />
      <View pointerEvents="none" style={styles.cameraBadge}><View style={styles.liveDot} /><Text style={styles.cameraBadgeText}>{busy ? 'ANALYZING' : 'CAMERA READY'}</Text></View>
    </View>
    <View style={[styles.panel, { paddingBottom: insets.bottom + 22 }]}>
      <View style={styles.resultRow}><View style={styles.resultIcon}><Text style={styles.resultIconText}>◎</Text></View><Text accessibilityLiveRegion="assertive" style={styles.resultText}>{message}</Text></View>
      <LargeActionButton label={busy ? 'Analyzing image' : 'Describe what’s ahead'} onPress={() => void capture()} loading={busy} icon={<Text style={styles.captureIcon}>●</Text>} />
      <LargeActionButton label="Return to navigation" onPress={back} variant="ghost" />
      <Text style={styles.warning}>Camera descriptions cannot determine route safety, safe crossings or the absence of obstacles.</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background }, headerWrap: { paddingHorizontal: spacing.lg }, cameraFrame: { flex: 1, minHeight: 300, marginHorizontal: spacing.lg, borderRadius: radii.lg, overflow: 'hidden', borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.surface }, camera: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  corner: { position: 'absolute', width: 32, height: 32, borderColor: colors.primary, borderWidth: 4 }, topLeft: { top: 16, left: 16, borderRightWidth: 0, borderBottomWidth: 0 }, topRight: { top: 16, right: 16, borderLeftWidth: 0, borderBottomWidth: 0 }, bottomLeft: { bottom: 16, left: 16, borderRightWidth: 0, borderTopWidth: 0 }, bottomRight: { bottom: 16, right: 16, borderLeftWidth: 0, borderTopWidth: 0 }, cameraBadge: { position: 'absolute', top: 18, alignSelf: 'center', borderRadius: radii.pill, backgroundColor: '#07100FCC', paddingHorizontal: 11, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 7 }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary }, cameraBadgeText: { color: colors.text, fontFamily: typography.family, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  panel: { paddingHorizontal: spacing.lg, paddingTop: 18, gap: 11, backgroundColor: colors.background }, resultRow: { minHeight: 74, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }, resultIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }, resultIconText: { color: colors.primary, fontSize: 21 }, resultText: { flex: 1, color: colors.textSoft, fontFamily: typography.family, fontSize: 15, lineHeight: 21 }, captureIcon: { color: colors.primaryText, fontSize: 17 }, warning: { color: colors.mutedDark, fontFamily: typography.family, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  center: { flex: 1, justifyContent: 'center', padding: 28, gap: 16, backgroundColor: colors.background }, permissionIcon: { width: 74, height: 74, borderRadius: 37, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }, permissionIconText: { color: colors.primary, fontSize: 32 }, centerTitle: { color: colors.text, fontFamily: typography.family, fontSize: 30, fontWeight: '900', textAlign: 'center' }, centerText: { color: colors.muted, fontFamily: typography.family, fontSize: 16, lineHeight: 24, textAlign: 'center' }, permissionActions: { marginTop: 18, gap: 11 },
});
