import { useEffect, useState } from 'react';
import * as Linking from 'expo-linking';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { supabase } from '@/src/auth/supabase';
import { colors, typography } from '@/src/theme';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string | string[]; error?: string | string[]; error_description?: string | string[] }>();
  const [message, setMessage] = useState('Completing secure sign-in…');

  useEffect(() => {
    let mounted = true;

    const first = (value?: string | string[]) => Array.isArray(value) ? value[0] : value;

    void (async () => {
      // Expo Router exposes the current callback parameters even when the app was
      // already open. getInitialURL is only a fallback for cold starts.
      let code = first(params.code);
      let providerError = first(params.error_description) || first(params.error);
      if (!code && !providerError) {
        const url = await Linking.getInitialURL();
        if (url) {
          const callback = new URL(url);
          code = callback.searchParams.get('code') ?? undefined;
          providerError = callback.searchParams.get('error_description') ?? callback.searchParams.get('error') ?? undefined;
        }
      }

      if (providerError) throw new Error(providerError);
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
      } else {
        const { data } = await supabase.auth.getSession();
        if (!data.session) throw new Error('No authenticated session was returned.');
      }
      if (mounted) router.replace('/account');
    })().catch(error => {
      if (mounted) setMessage(error instanceof Error ? error.message : 'Authentication could not be completed.');
    });

    return () => { mounted = false; };
  }, [params.code, params.error, params.error_description, router]);

  return <View style={styles.root}><Text accessibilityLiveRegion="polite" style={styles.text}>{message}</Text></View>;
}

const styles = StyleSheet.create({ root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.background }, text: { color: colors.text, fontFamily: typography.family, fontSize: 18, lineHeight: 26, fontWeight: '800', textAlign: 'center' } });
