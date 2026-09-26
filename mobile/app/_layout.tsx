import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/src/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.background },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false, title: 'SENSEA' }} />
        <Stack.Screen name="routes" options={{ title: '경로 선택', headerBackTitle: '뒤로' }} />
        <Stack.Screen name="navigate" options={{ title: '음성 안내', headerBackTitle: '경로' }} />
        <Stack.Screen name="camera" options={{ title: '주변 설명', headerBackTitle: '안내' }} />
      </Stack>
    </SafeAreaProvider>
  );
}

