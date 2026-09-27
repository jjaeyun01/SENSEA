import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomNav } from '@/src/components/BottomNav';
import { BrandMark } from '@/src/components/BrandMark';
import { LargeActionButton } from '@/src/components/LargeActionButton';
import { useAppPreferences } from '@/src/state/AppPreferences';
import { colors, radii, spacing, typography } from '@/src/theme';

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const preferences = useAppPreferences();
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [voice, setVoice] = useState(true);
  const [haptics, setHaptics] = useState(true);
  const [error, setError] = useState('');

  const signIn = () => {
    if (!email.includes('@') || password.length < 6) { setError('Enter a valid email and a password with at least 6 characters.'); return; }
    preferences.signIn(email); setPassword(''); setError(''); setShowLogin(false);
  };

  return <View style={styles.root}>
    <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 126 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.top}><BrandMark compact /><Text style={styles.topLabel}>PROFILE & SETTINGS</Text></View>

      {preferences.email ? <View style={styles.accountCard}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{preferences.email.slice(0, 1).toUpperCase()}</Text></View>
        <View style={styles.accountCopy}><Text style={styles.accountName}>Signed in</Text><Text style={styles.accountEmail}>{preferences.email}</Text><Text style={styles.syncText}>Preferences can be synced when an account service is connected.</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={preferences.signOut} style={styles.textButton}><Text style={styles.textButtonLabel}>Sign out</Text></Pressable>
      </View> : <View style={styles.guestCard}>
        <View style={styles.guestIcon}><Text style={styles.guestIconText}>○</Text></View><Text accessibilityRole="header" style={styles.guestTitle}>Using SENSEA as a guest</Text><Text style={styles.guestText}>All core navigation features work without an account. Sign in only if you want to keep preferences with a future account service.</Text>
        {!showLogin && <LargeActionButton label="Sign in or create account" onPress={() => setShowLogin(true)} />}
        {showLogin && <View style={styles.form}>
          <Text style={styles.fieldLabel}>Email</Text><TextInput accessibilityLabel="Email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={colors.mutedDark} style={styles.input} />
          <Text style={styles.fieldLabel}>Password</Text><TextInput accessibilityLabel="Password" secureTextEntry autoComplete="password" value={password} onChangeText={setPassword} placeholder="At least 6 characters" placeholderTextColor={colors.mutedDark} style={styles.input} />
          {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          <LargeActionButton label="Sign in" onPress={signIn} />
          <LargeActionButton label="Continue as guest" onPress={() => { setShowLogin(false); setError(''); }} variant="ghost" />
          <Text style={styles.prototypeNote}>Prototype login is stored only for this app session; connect a production authentication service before release.</Text>
        </View>}
      </View>}

      <View style={styles.section}><Text style={styles.sectionTitle}>Guidance settings</Text>
        <SettingRow title="Voice feedback" description="Read navigation cues aloud automatically." value={voice} onChange={setVoice} />
        <SettingRow title="Haptic feedback" description="Vibrate for upcoming turns and important alerts." value={haptics} onChange={setHaptics} />
        <Pressable accessibilityRole="button" onPress={() => router.push('/preferences')} style={styles.linkRow}><View><Text style={styles.linkTitle}>Route preferences</Text><Text style={styles.linkDescription}>Priority: {preferences.routePriority.replace('stepFree', 'step-free')}</Text></View><Text style={styles.chevron}>›</Text></Pressable>
      </View>

      <View style={styles.section}><Text style={styles.sectionTitle}>Privacy & app</Text>
        <Pressable accessibilityRole="button" onPress={() => router.push('/settings')} style={styles.linkRow}><View><Text style={styles.linkTitle}>Privacy and interaction records</Text><Text style={styles.linkDescription}>Manage on-device records and open-source notices.</Text></View><Text style={styles.chevron}>›</Text></Pressable>
        <View style={styles.infoRow}><Text style={styles.infoLabel}>Account required</Text><Text style={styles.infoValue}>No</Text></View>
        <View style={styles.infoRow}><Text style={styles.infoLabel}>App version</Text><Text style={styles.infoValue}>0.4.0</Text></View>
      </View>
    </ScrollView>
    <BottomNav active="profile" />
  </View>;
}

function SettingRow({ title, description, value, onChange }: { title: string; description: string; value: boolean; onChange: (value: boolean) => void }) {
  return <View style={styles.settingRow}><View style={styles.settingCopy}><Text style={styles.linkTitle}>{title}</Text><Text style={styles.linkDescription}>{description}</Text></View><Switch accessibilityLabel={title} value={value} onValueChange={onChange} trackColor={{ false: colors.surfaceHighlight, true: colors.primary }} thumbColor={colors.background} /></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background }, container: { paddingHorizontal: spacing.lg, gap: spacing.xl }, top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, topLabel: { color: colors.mutedDark, fontFamily: typography.family, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  accountCard: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 18, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary }, avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }, avatarText: { color: colors.primaryText, fontFamily: typography.family, fontSize: 23, fontWeight: '900' }, accountCopy: { flex: 1, gap: 2 }, accountName: { color: colors.text, fontFamily: typography.family, fontSize: 18, fontWeight: '900' }, accountEmail: { color: colors.primary, fontFamily: typography.family, fontSize: 13 }, syncText: { color: colors.muted, fontFamily: typography.family, fontSize: 10, lineHeight: 14, marginTop: 3 }, textButton: { padding: 9 }, textButtonLabel: { color: colors.muted, fontFamily: typography.family, fontSize: 12, fontWeight: '800' },
  guestCard: { padding: 20, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 12 }, guestIcon: { width: 62, height: 62, borderRadius: 31, alignSelf: 'center', backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }, guestIconText: { color: colors.primary, fontSize: 35 }, guestTitle: { color: colors.text, fontFamily: typography.family, fontSize: 23, fontWeight: '900', textAlign: 'center' }, guestText: { color: colors.muted, fontFamily: typography.family, fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 4 },
  form: { gap: 9, marginTop: 4 }, fieldLabel: { color: colors.textSoft, fontFamily: typography.family, fontSize: 12, fontWeight: '800', marginTop: 3 }, input: { minHeight: 54, borderRadius: radii.md, backgroundColor: colors.backgroundSoft, borderWidth: 1, borderColor: colors.border, color: colors.text, paddingHorizontal: 15, fontFamily: typography.family, fontSize: 16 }, error: { color: colors.danger, fontFamily: typography.family, fontSize: 12, lineHeight: 17 }, prototypeNote: { color: colors.mutedDark, fontFamily: typography.family, fontSize: 10, lineHeight: 15, textAlign: 'center' },
  section: { gap: 10 }, sectionTitle: { color: colors.textSoft, fontFamily: typography.family, fontSize: 16, fontWeight: '900', marginBottom: 2 }, settingRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, settingCopy: { flex: 1 }, linkRow: { minHeight: 76, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: 15, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, linkTitle: { color: colors.text, fontFamily: typography.family, fontSize: 15, fontWeight: '800' }, linkDescription: { color: colors.muted, fontFamily: typography.family, fontSize: 11, lineHeight: 16, marginTop: 3 }, chevron: { color: colors.primary, fontSize: 28 }, infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 4 }, infoLabel: { color: colors.muted, fontFamily: typography.family, fontSize: 13 }, infoValue: { color: colors.textSoft, fontFamily: typography.family, fontSize: 13, fontWeight: '800' },
});
