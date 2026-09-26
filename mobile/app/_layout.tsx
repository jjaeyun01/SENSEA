import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationProvider } from '@/src/state/NavigationState';
import { colors } from '@/src/theme';

export default function RootLayout() {
  return <SafeAreaProvider><NavigationProvider><StatusBar style="light" /><Stack screenOptions={{ headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text, contentStyle: { backgroundColor: colors.background } }}>
    <Stack.Screen name="index" options={{ headerShown: false }} />
    <Stack.Screen name="routes" options={{ title: 'Choose a route' }} />
    <Stack.Screen name="navigate" options={{ title: 'Demo navigation' }} />
    <Stack.Screen name="camera" options={{ title: 'Describe surroundings' }} />
  </Stack></NavigationProvider></SafeAreaProvider>;
}
