import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { ApiError, describeImage } from '@/src/api/client';
import { LargeActionButton } from '@/src/components/LargeActionButton';
import { useNavigationState } from '@/src/state/NavigationState';
import { colors } from '@/src/theme';
import { speak, stopSpeaking } from '@/src/voice/speak';

export default function CameraScreen() {
  const router = useRouter(); const [state, dispatch] = useNavigationState(); const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('Please stop walking before using camera assistance.');
  useEffect(() => { void speak(message); return () => { void stopSpeaking(); }; }, []);
  const back = () => { dispatch({ type: 'STATUS', status: 'NAVIGATING' }); router.back(); };
  const capture = async () => {
    if (!camera.current) return; setBusy(true); setMessage('Capturing one still image for assistive description.');
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.55, skipProcessing: false });
      if (!photo?.uri) throw new Error('No image was captured.');
      const result = await describeImage(photo.uri, state.destination?.name);
      const uncertainty = result.uncertainty >= 0.5 ? "I'm not certain. " : '';
      const text = `${uncertainty}${result.description}`; setMessage(text); void speak(text);
    } catch (error) { const text = error instanceof ApiError ? error.message : 'The image could not be described. You can retry or return to navigation.'; setMessage(text); void speak(text); }
    finally { setBusy(false); }
  };
  if (!permission) return <View style={styles.center}><Text style={styles.text}>Checking camera permission status.</Text><LargeActionButton label="Cancel and return to navigation" onPress={back} variant="secondary" /></View>;
  if (!permission.granted) return <View style={styles.center}><Text accessibilityRole="header" style={styles.title}>Camera permission</Text><Text accessibilityLiveRegion="polite" style={styles.text}>Camera access is requested only for one user-initiated still image. The app does not keep a gallery or continuous video.</Text><LargeActionButton label="Grant camera permission" accessibilityHint="Opens the operating system camera permission prompt" onPress={() => void requestPermission()} /><LargeActionButton label="Camera unavailable — return to navigation" onPress={back} variant="secondary" /></View>;
  return <View style={styles.root}><CameraView ref={camera} facing="back" style={styles.camera} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" /><View style={styles.controls}><Text accessibilityRole="header" style={styles.title}>Assistive visual description</Text><Text accessibilityLiveRegion="assertive" style={styles.text}>{message}</Text><LargeActionButton label={busy ? 'Processing still image' : 'Take one picture and describe it'} accessibilityHint="Captures one JPEG and sends it to the backend without retaining it there" onPress={() => void capture()} loading={busy} /><LargeActionButton label="Retry picture" accessibilityHint="Captures a new still image" onPress={() => void capture()} disabled={busy} variant="secondary" /><LargeActionButton label="Return to navigation" onPress={back} variant="secondary" /><Text style={styles.warning}>Descriptions cannot determine route safety, safe crossings, obstacle absence, or entrance accessibility.</Text></View></View>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.background }, center: { flex: 1, justifyContent: 'center', padding: 24, gap: 18, backgroundColor: colors.background }, camera: { flex: 1, minHeight: 250 }, controls: { padding: 20, gap: 12, backgroundColor: colors.background }, title: { color: colors.text, fontSize: 26, fontWeight: '800' }, text: { color: colors.text, fontSize: 18, lineHeight: 27 }, warning: { color: colors.warning, fontSize: 15, lineHeight: 23 } });
