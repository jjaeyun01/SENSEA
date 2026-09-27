import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationProvider } from '@/src/state/NavigationState';
import { colors } from '@/src/theme';

export default function RootLayout() {
  return <SafeAreaProvider><NavigationProvider><StatusBar style="light" /><Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: colors.background } }}>
    <Stack.Screen name="index" options={{ headerShown: false }} />
    <Stack.Screen name="routes" />
    <Stack.Screen name="navigate" />
    <Stack.Screen name="camera" />
    <Stack.Screen name="settings" />
  </Stack></NavigationProvider></SafeAreaProvider>;
}
