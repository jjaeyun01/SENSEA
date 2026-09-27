import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth, type UserPreferences } from '@/src/auth/AuthProvider';
import { AppHeader } from '@/src/components/AppHeader';
import { LargeActionButton } from '@/src/components/LargeActionButton';
import { colors, radii, spacing, typography } from '@/src/theme';

const ROUTE_OPTIONS: { value: UserPreferences['route_priority']; label: string }[] = [
  { value: 'safety', label: 'Safety' }, { value: 'flat', label: 'Flat' },
  { value: 'fastest', label: 'Fastest' }, { value: 'balanced', label: 'Balanced' },
];
const TIMEZONES = ['America/Chicago', 'America/New_York', 'America/Los_Angeles'];

export default function AccountScreen() {
  const router = useRouter(); const insets = useSafeAreaInsets(); const auth = useAuth();
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [emergency, setEmergency] = useState('');
  const [timezone, setTimezone] = useState('America/Chicago'); const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  useEffect(() => {
    setName(auth.profile?.name ?? ''); setPhone(auth.profile?.phone_number ?? '');
    setEmergency(auth.profile?.emergency_contact ?? ''); setTimezone(auth.profile?.timezone ?? 'America/Chicago');
  }, [auth.profile]);
  if (!auth.user) return <View style={[styles.root, styles.signedOut, { paddingTop: insets.top + 20 }]}><Text accessibilityRole="header" style={styles.signedOutTitle}>Sign in to sync your SENSEA data</Text><Text style={styles.copy}>Your local navigation can still work without an account.</Text><LargeActionButton label="Sign in or create account" onPress={() => router.replace('/auth')} /><LargeActionButton label="Back to home" variant="ghost" onPress={() => router.replace('/')} /></View>;

  const showError = (error: unknown, fallback: string) => setMessage(error instanceof Error ? error.message : fallback);
  const saveProfile = async () => {
    setBusy(true); setMessage('');
    try { await auth.updateProfile({ name, phone_number: phone, emergency_contact: emergency, timezone }); setMessage('Profile saved.'); }
    catch (error) { showError(error, 'Could not save profile.'); }
    finally { setBusy(false); }
  };
  const changePreference = async (value: Partial<UserPreferences>) => {
    setMessage('');
    try { await auth.updatePreferences(value); setMessage('Route preferences saved.'); }
    catch (error) { showError(error, 'Could not save route preferences.'); }
  };
  const callEmergencyContact = () => {
    const number = emergency.trim().replace(/[^0-9+*#,;]/g, '');
    if (!number || !/[0-9]/.test(number)) { setMessage('Enter a callable emergency contact number first.'); return; }
    Alert.alert('Call emergency contact?', `SENSEA will open the phone app for ${emergency.trim()}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open phone app', onPress: () => void Linking.openURL(`tel:${number}`).catch(error => showError(error, 'Could not open the phone app.')) },
    ]);
  };
  const shareCurrentLocation = () => Alert.alert(
    'Share your current location?',
    'Your coordinates will be placed in the system share sheet. Choose a trusted recipient. SENSEA does not send them automatically.',
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Continue', onPress: () => void (async () => {
      setBusy(true); setMessage('Finding your location…');
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) throw new Error('Location permission was not granted.');
        const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        if (fix.coords.accuracy == null || fix.coords.accuracy > 50) throw new Error('Location accuracy is too low to share. Please retry outdoors.');
        const { latitude, longitude } = fix.coords;
        await Share.share({ message: `My current location: https://maps.google.com/?q=${latitude},${longitude}\nAccuracy: approximately ${Math.round(fix.coords.accuracy)} metres.` });
        setMessage('Location share sheet opened.');
      } catch (error) { showError(error, 'Could not share the current location.'); }
      finally { setBusy(false); }
    })() }],
  );
  const exportData = async () => {
    try { await Share.share({ title: 'SENSEA data export', message: await auth.exportUserData() }); setMessage('Data export share sheet opened.'); }
    catch (error) { showError(error, 'Could not export your data.'); }
  };
  const confirmDeleteAllData = () => Alert.alert('Delete all SENSEA data?', 'This removes your profile, preferences, places, route history, noise consent and contributed measurements. Your login account remains active.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete data', style: 'destructive', onPress: () => void auth.deleteAllUserData().then(() => setMessage('All SENSEA data was deleted. Your login account remains active.')).catch(error => showError(error, 'Could not delete your data.')) },
  ]);
  const confirmDeleteAccount = () => Alert.alert('Permanently delete account?', 'This deletes the login account and all associated SENSEA data. This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete account', style: 'destructive', onPress: () => void auth.deleteAccount().then(() => router.replace('/')).catch(error => showError(error, 'Could not delete the account. Make sure migration 005 is installed.')) },
  ]);
  const noise = auth.currentNoisePreference();

  return <ScrollView style={styles.root} showsVerticalScrollIndicator={false} contentContainerStyle={[styles.container, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 36 }]}>
    <AppHeader title={auth.profile?.name || 'Your account'} eyebrow="PROFILE & ROUTES" onBack={() => router.back()} />
    <View style={styles.identity}><View style={styles.avatar}><Text style={styles.avatarText}>{(auth.profile?.name || auth.user.email || 'S').slice(0, 1).toUpperCase()}</Text></View><View style={styles.identityCopy}><Text style={styles.email}>{auth.user.email}</Text><Text style={styles.provider}>{auth.user.app_metadata.provider === 'google' ? 'Google account' : 'Email account'} · Cloud sync on</Text></View></View>

    <Section title="Personal profile" subtitle="Only you can access this information.">
      <Field label="Name" value={name} onChangeText={setName} />
      <Field label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field label="Emergency contact" value={emergency} onChangeText={setEmergency} keyboardType="phone-pad" />
      <Field label="Timezone" value={timezone} onChangeText={setTimezone} autoCapitalize="none" autoCorrect={false} />
      <View style={styles.presetRow}>{TIMEZONES.map(value => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`Set timezone to ${value}`} onPress={() => setTimezone(value)} style={[styles.preset, timezone === value && styles.presetActive]}><Text style={styles.presetText}>{value.replace('America/', '')}</Text></Pressable>)}</View>
      <LargeActionButton label="Save profile" onPress={() => void saveProfile()} loading={busy} />
      <LargeActionButton label="Call emergency contact" onPress={callEmergencyContact} variant="secondary" />
      <LargeActionButton label="Share current location" onPress={shareCurrentLocation} variant="secondary" loading={busy} />
    </Section>

    <Section title="Route preference" subtitle="These settings are stored separately for your account.">
      <View accessibilityRole="radiogroup" style={styles.options}>{ROUTE_OPTIONS.map(option => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: auth.preferences?.route_priority === option.value }} onPress={() => void changePreference({ route_priority: option.value })} style={[styles.option, auth.preferences?.route_priority === option.value && styles.optionActive]}><Text style={[styles.optionText, auth.preferences?.route_priority === option.value && styles.optionTextActive]}>{option.label}</Text></Pressable>)}</View>
      <Preference label="Avoid stairs" value={auth.preferences?.avoid_stairs ?? true} onChange={value => void changePreference({ avoid_stairs: value })} />
      <Preference label="Avoid mixed vehicle/pedestrian roads" value={auth.preferences?.avoid_mixed_traffic ?? true} onChange={value => void changePreference({ avoid_mixed_traffic: value })} />
      <Preference label="Prefer crosswalks" value={auth.preferences?.prefer_crosswalks ?? true} onChange={value => void changePreference({ prefer_crosswalks: value })} />
      <Preference label="Avoid construction" value={auth.preferences?.avoid_construction ?? true} onChange={value => void changePreference({ avoid_construction: value })} />
    </Section>

    <Section title="Automatic noise policy" subtitle="Applied using your profile timezone.">
      <View style={styles.noiseCard}><View style={[styles.noiseDot, { backgroundColor: noise === 'quiet' ? colors.primary : colors.warning }]} /><View style={styles.noiseCopy}><Text style={styles.noiseTitle}>{noise === 'quiet' ? 'Daytime: prefer quieter routes' : 'Nighttime: prefer more active-sounding routes'}</Text><Text style={styles.copy}>Day {auth.preferences?.day_starts_at?.slice(0, 5) ?? '07:00'}–{auth.preferences?.night_starts_at?.slice(0, 5) ?? '19:00'} · Night otherwise</Text></View></View>
      <Text style={styles.caution}>Noise is only a relative sound measurement. It does not prove that people are present or that a route is safe.</Text>
    </Section>

    <Section title="Your places" subtitle="Saved, favorite, and recently visited destinations.">
      {auth.places.length ? auth.places.slice(0, 10).map(place => <View key={place.id} style={styles.placeRow}><View style={styles.placeCopy}><Text style={styles.placeName}>{place.name}</Text><Text style={styles.copy} numberOfLines={1}>{place.address || 'Address unavailable'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`${place.is_saved ? 'Remove' : 'Save'} ${place.name}`} onPress={() => void auth.setPlaceFlag(place, 'is_saved', !place.is_saved)} style={[styles.miniButton, place.is_saved && styles.miniActive]}><Text style={styles.miniText}>{place.is_saved ? 'Saved' : 'Save'}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`${place.is_favorite ? 'Unfavorite' : 'Favorite'} ${place.name}`} onPress={() => void auth.setPlaceFlag(place, 'is_favorite', !place.is_favorite)} style={[styles.starButton, place.is_favorite && styles.starActive]}><Text style={styles.star}>{place.is_favorite ? '★' : '☆'}</Text></Pressable><DeleteButton label={`Delete ${place.name} from your places`} onPress={() => Alert.alert('Delete place?', place.name, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void auth.deletePlace(place.id).catch(error => showError(error, 'Could not delete the place.')) }])} /></View>) : <Text style={styles.empty}>Your recent destinations will appear here after you select one.</Text>}
    </Section>

    <Section title="Recent routes" subtitle="Routes started on this account; arrival is shown only when recorded.">
      {auth.routeHistory.length ? auth.routeHistory.map(route => <View key={route.id} style={styles.placeRow}><View style={styles.placeCopy}><Text style={styles.placeName}>{route.destination_name}</Text><Text style={styles.copy}>{new Date(route.started_at).toLocaleString()} · {route.distance_m == null ? 'Distance unavailable' : `${Math.round(route.distance_m)} m`} · {route.completed_at ? 'Completed' : 'Started'}</Text></View><DeleteButton label={`Delete route to ${route.destination_name}`} onPress={() => Alert.alert('Delete route history?', route.destination_name, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void auth.deleteRouteHistory(route.id).catch(error => showError(error, 'Could not delete route history.')) }])} /></View>) : <Text style={styles.empty}>Routes you start will appear here.</Text>}
    </Section>

    <Section title="Password and recovery" subtitle="Google accounts can continue using Google sign-in.">
      <Field label="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry autoCapitalize="none" />
      <LargeActionButton label="Change password" onPress={() => void auth.updatePassword(newPassword).then(() => { setNewPassword(''); setMessage('Password changed.'); }).catch(error => showError(error, 'Could not change the password.'))} variant="secondary" />
      <LargeActionButton label="Email password reset link" onPress={() => void auth.sendPasswordReset().then(() => setMessage('Password reset email sent.')).catch(error => showError(error, 'Could not send the reset email.'))} variant="ghost" />
    </Section>

    <Section title="Your data" subtitle="Export or remove account-owned data.">
      <LargeActionButton label="Export my data" onPress={() => void exportData()} variant="secondary" />
      <LargeActionButton label="Delete all SENSEA data" onPress={confirmDeleteAllData} variant="danger" />
      <Text style={styles.caution}>Deleting all data keeps your login account. Deleting the account below removes both the login and all associated data.</Text>
    </Section>

    {!!message && <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text>}
    <LargeActionButton label="Sign out" variant="danger" onPress={() => void auth.signOut().then(() => router.replace('/'))} />
    <LargeActionButton label="Permanently delete account" variant="danger" onPress={confirmDeleteAccount} />
  </ScrollView>;
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) { return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.sectionSubtitle}>{subtitle}</Text><View style={styles.sectionBody}>{children}</View></View>; }
function Field({ label, ...props }: React.ComponentProps<typeof TextInput> & { label: string }) { return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput {...props} accessibilityLabel={label} placeholder={label} placeholderTextColor={colors.mutedDark} style={styles.input} /></View>; }
function Preference({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) { return <View style={styles.preference}><Text style={styles.preferenceLabel}>{label}</Text><Switch accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ false: colors.surfaceHighlight, true: colors.primary }} thumbColor={colors.background} /></View>; }
function DeleteButton({ label, onPress }: { label: string; onPress: () => void }) { return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.deleteMini}><Text style={styles.deleteMiniText}>Delete</Text></Pressable>; }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background }, container: { paddingHorizontal: spacing.lg, gap: spacing.lg }, signedOut: { paddingHorizontal: spacing.lg, justifyContent: 'center', gap: spacing.lg }, signedOutTitle: { color: colors.text, fontFamily: typography.family, fontSize: 30, fontWeight: '900' },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border }, avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }, avatarText: { color: colors.primaryText, fontSize: 24, fontWeight: '900' }, identityCopy: { flex: 1, gap: 3 }, email: { color: colors.text, fontFamily: typography.family, fontSize: 16, fontWeight: '800' }, provider: { color: colors.primary, fontFamily: typography.family, fontSize: 13 },
  section: { gap: 4 }, sectionTitle: { color: colors.text, fontFamily: typography.family, fontSize: 22, fontWeight: '900' }, sectionSubtitle: { color: colors.muted, fontFamily: typography.family, fontSize: 14, lineHeight: 20, marginBottom: 10 }, sectionBody: { gap: 13, padding: 17, backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border },
  field: { gap: 6 }, label: { color: colors.textSoft, fontFamily: typography.family, fontSize: 14, fontWeight: '800' }, input: { minHeight: 54, paddingHorizontal: 15, color: colors.text, backgroundColor: colors.backgroundSoft, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, fontFamily: typography.family, fontSize: 16 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, preset: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 10, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border }, presetActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft }, presetText: { color: colors.textSoft, fontFamily: typography.family, fontSize: 11, fontWeight: '800' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, option: { minHeight: 44, paddingHorizontal: 15, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, optionActive: { backgroundColor: colors.primary, borderColor: colors.primary }, optionText: { color: colors.textSoft, fontFamily: typography.family, fontSize: 14, fontWeight: '800' }, optionTextActive: { color: colors.primaryText }, preference: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }, preferenceLabel: { flex: 1, color: colors.textSoft, fontFamily: typography.family, fontSize: 15, fontWeight: '700' },
  noiseCard: { flexDirection: 'row', alignItems: 'center', gap: 12 }, noiseDot: { width: 14, height: 14, borderRadius: 7 }, noiseCopy: { flex: 1, gap: 3 }, noiseTitle: { color: colors.text, fontFamily: typography.family, fontSize: 16, fontWeight: '900' }, copy: { color: colors.muted, fontFamily: typography.family, fontSize: 13, lineHeight: 19 }, caution: { color: colors.warning, fontFamily: typography.family, fontSize: 13, lineHeight: 19, padding: 12, backgroundColor: colors.warningSoft, borderRadius: radii.sm },
  placeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingVertical: 5 }, placeCopy: { flex: 1, minWidth: 150, gap: 2 }, placeName: { color: colors.text, fontFamily: typography.family, fontSize: 15, fontWeight: '800' }, miniButton: { minHeight: 38, paddingHorizontal: 11, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' }, miniActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft }, miniText: { color: colors.textSoft, fontFamily: typography.family, fontSize: 12, fontWeight: '800' }, starButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, starActive: { backgroundColor: colors.warningSoft }, star: { color: colors.warning, fontSize: 24 }, deleteMini: { minHeight: 38, paddingHorizontal: 10, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.danger, justifyContent: 'center' }, deleteMiniText: { color: colors.danger, fontFamily: typography.family, fontSize: 11, fontWeight: '900' },
  empty: { color: colors.muted, fontFamily: typography.family, fontSize: 14, lineHeight: 20 }, message: { color: colors.primary, fontFamily: typography.family, fontSize: 14, fontWeight: '800', textAlign: 'center' },
});
