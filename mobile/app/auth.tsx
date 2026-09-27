import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader } from '@/src/components/AppHeader';
import { BrandMark } from '@/src/components/BrandMark';
import { LargeActionButton } from '@/src/components/LargeActionButton';
import { useAuth } from '@/src/auth/AuthProvider';
import { colors, radii, spacing, typography } from '@/src/theme';

type Mode = 'signIn' | 'signUp';

export default function AuthScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const submit = async () => {
    setBusy(true); setMessage('');
    try {
      if (mode === 'signUp') {
        const result = await auth.signUp({ email, password, name, phoneNumber, emergencyContact });
        if (result.needsEmailConfirmation) {
          setMessage('Check your email to confirm your account, then return and sign in.');
          setMode('signIn'); setPassword('');
        } else router.replace('/account');
      } else {
        await auth.signIn(email, password);
        router.replace('/account');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Authentication failed. Please try again.');
    } finally { setBusy(false); }
  };

  const google = async () => {
    setBusy(true); setMessage('');
    try { await auth.signInWithGoogle(); if (auth.user || Platform.OS !== 'web') router.replace('/account'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Google sign-in failed.'); }
    finally { setBusy(false); }
  };

  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={[styles.container, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 32 }]}>
      <AppHeader title="Your SENSEA account" eyebrow="SECURE & PERSONAL" onBack={() => router.back()} />
      <View style={styles.brand}><BrandMark /><Text style={styles.intro}>Sync destinations, route preferences, and recent trips across your devices.</Text></View>

      {!auth.configured && <View accessibilityRole="alert" style={styles.warning}><Text style={styles.warningTitle}>Supabase setup required</Text><Text style={styles.warningText}>Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY to mobile/.env, then restart Expo.</Text></View>}

      <View accessibilityRole="tablist" style={styles.tabs}>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: mode === 'signIn' }} onPress={() => { setMode('signIn'); setMessage(''); }} style={[styles.tab, mode === 'signIn' && styles.tabActive]}><Text style={[styles.tabText, mode === 'signIn' && styles.tabTextActive]}>Sign in</Text></Pressable>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: mode === 'signUp' }} onPress={() => { setMode('signUp'); setMessage(''); }} style={[styles.tab, mode === 'signUp' && styles.tabActive]}><Text style={[styles.tabText, mode === 'signUp' && styles.tabTextActive]}>Create account</Text></Pressable>
      </View>

      <View style={styles.form}>
        {mode === 'signUp' && <>
          <Field label="Name" value={name} onChangeText={setName} autoComplete="name" />
          <Field label="Phone number" value={phoneNumber} onChangeText={setPhoneNumber} keyboardType="phone-pad" autoComplete="tel" optional />
          <Field label="Emergency contact" value={emergencyContact} onChangeText={setEmergencyContact} keyboardType="phone-pad" autoComplete="tel" optional hint="Name and phone number" />
        </>}
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'} hint={mode === 'signUp' ? 'At least 8 characters' : undefined} />
        <LargeActionButton disabled={!auth.configured} loading={busy} label={mode === 'signUp' ? 'Create account' : 'Sign in'} onPress={() => void submit()} />
        {mode === 'signIn' && <LargeActionButton disabled={!auth.configured || busy} label="Forgot password" variant="ghost" onPress={() => void auth.sendPasswordReset(email).then(() => setMessage('Check your email for a secure password reset link.')).catch(error => setMessage(error instanceof Error ? error.message : 'Could not send the reset email.'))} />}
        <View style={styles.divider}><View style={styles.line} /><Text style={styles.or}>OR</Text><View style={styles.line} /></View>
        <LargeActionButton disabled={!auth.configured} loading={busy} label="Continue with Google" variant="secondary" onPress={() => void google()} icon={<Text style={styles.google}>G</Text>} />
      </View>
      {!!message && <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text>}
      <Text style={styles.privacy}>Passwords are handled by Supabase Auth and are never stored in SENSEA profile tables. Emergency contact data is protected by per-user database access rules.</Text>
    </ScrollView>
  </KeyboardAvoidingView>;
}

function Field({ label, optional, hint, ...props }: React.ComponentProps<typeof TextInput> & { label: string; optional?: boolean; hint?: string }) {
  return <View style={styles.field}><View style={styles.fieldHeader}><Text style={styles.label}>{label}</Text>{optional && <Text style={styles.optional}>OPTIONAL</Text>}</View><TextInput {...props} accessibilityLabel={label} accessibilityHint={hint} placeholder={hint || label} placeholderTextColor={colors.mutedDark} style={styles.input} /></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background }, container: { paddingHorizontal: spacing.lg, gap: spacing.lg }, brand: { gap: 12, alignItems: 'flex-start' }, intro: { color: colors.muted, fontFamily: typography.family, fontSize: 16, lineHeight: 24 },
  warning: { padding: 16, borderRadius: radii.md, backgroundColor: colors.warningSoft, borderWidth: 1, borderColor: colors.warning, gap: 5 }, warningTitle: { color: colors.warning, fontFamily: typography.family, fontSize: 17, fontWeight: '900' }, warningText: { color: colors.textSoft, fontFamily: typography.family, fontSize: 14, lineHeight: 20 },
  tabs: { flexDirection: 'row', padding: 4, borderRadius: radii.pill, backgroundColor: colors.surface }, tab: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill }, tabActive: { backgroundColor: colors.primary }, tabText: { color: colors.muted, fontFamily: typography.family, fontSize: 16, fontWeight: '800' }, tabTextActive: { color: colors.primaryText },
  form: { gap: 16 }, field: { gap: 7 }, fieldHeader: { flexDirection: 'row', justifyContent: 'space-between' }, label: { color: colors.textSoft, fontFamily: typography.family, fontSize: 15, fontWeight: '800' }, optional: { color: colors.mutedDark, fontFamily: typography.family, fontSize: 10, fontWeight: '900', letterSpacing: 1 }, input: { minHeight: 58, paddingHorizontal: 17, color: colors.text, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, fontFamily: typography.family, fontSize: 17 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12 }, line: { height: 1, backgroundColor: colors.border, flex: 1 }, or: { color: colors.mutedDark, fontFamily: typography.family, fontSize: 11, fontWeight: '900' }, google: { width: 28, height: 28, textAlign: 'center', textAlignVertical: 'center', color: colors.text, fontSize: 19, fontWeight: '900' }, message: { color: colors.primary, fontFamily: typography.family, fontSize: 15, lineHeight: 21, fontWeight: '700' }, privacy: { color: colors.mutedDark, fontFamily: typography.family, fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
