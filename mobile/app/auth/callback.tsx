import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { colors, typography } from '@/src/theme';

export default function AuthCallbackScreen() {
  const router = useRouter();
  useEffect(() => { const timer = setTimeout(() => router.replace('/account'), 300); return () => clearTimeout(timer); }, [router]);
  return <View style={styles.root}><Text accessibilityLiveRegion="polite" style={styles.text}>Completing secure sign-in…</Text></View>;
}
const styles = StyleSheet.create({ root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }, text: { color: colors.text, fontFamily: typography.family, fontSize: 18, fontWeight: '800' } });
