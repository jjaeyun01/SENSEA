import { useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { JourneyProvider } from '@/src/navigation/JourneyProvider';
import { CameraProvider } from '@/src/camera/CameraProvider';
import { NoiseMonitorProvider } from '@/src/noise/NoiseMonitorProvider';
import { AppPreferencesProvider } from '@/src/state/AppPreferences';
import { setFeedbackScreenReader, stopFeedback } from '@/src/navigation/feedback';
import { colors } from '@/src/theme';
export default function RootLayout() {
  useEffect(() => {
    let changed = false, mounted = true;
    const listener = AccessibilityInfo.addEventListener('screenReaderChanged', value => { changed = true; stopFeedback(); setFeedbackScreenReader(value); });
    void AccessibilityInfo.isScreenReaderEnabled().then(value => { if (mounted && !changed) setFeedbackScreenReader(value); });
    return () => { mounted = false; listener.remove(); };
  }, []);
  return <SafeAreaProvider><CameraProvider><NoiseMonitorProvider><JourneyProvider><AppPreferencesProvider><StatusBar style="dark" /><Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: colors.background } }}>
    <Stack.Screen name="index" /><Stack.Screen name="routes" /><Stack.Screen name="navigate" />
    <Stack.Screen name="camera" /><Stack.Screen name="settings" /><Stack.Screen name="map" />
    <Stack.Screen name="preferences" /><Stack.Screen name="profile" />
    <Stack.Screen name="destination" /><Stack.Screen name="scan" />
  </Stack></AppPreferencesProvider></JourneyProvider></NoiseMonitorProvider></CameraProvider></SafeAreaProvider>;
}
