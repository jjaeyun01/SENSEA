import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomNav } from '@/src/components/BottomNav';
import { useAppPreferences, type RoutePriority } from '@/src/state/AppPreferences';
import { colors, radii, spacing, typography } from '@/src/theme';

const priorities: { key: RoutePriority; icon: string; title: string; description: string }[] = [
  { key: 'safety', icon: '◇', title: 'Pedestrian conditions', description: 'Prioritize verified obstacles, crossings and pedestrian separation.' },
  { key: 'flat', icon: '⌁', title: 'Flatter', description: 'Give verified slopes and stairs more weight when available.' },
  { key: 'fastest', icon: '→', title: 'Fastest', description: 'Prioritize the shortest estimated walking time.' },
  { key: 'balanced', icon: '≋', title: 'Balanced', description: 'Balance travel time with verified pedestrian conditions.' },
];

export default function PreferencesScreen() {
  const insets = useSafeAreaInsets();
  const preferences = useAppPreferences();
  const [status, setStatus] = useState('Changes are applied to future route comparisons.');
  const changePriority = async (key: RoutePriority) => {
    try { await preferences.setRoutePriority(key); setStatus('Route priority saved.'); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Could not save route priority.'); }
  };
  const changeConstruction = async (value: boolean) => {
    try { await preferences.setAvoidConstruction(value); setStatus('Construction preference saved.'); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Could not save construction preference.'); }
  };
  return <View style={styles.root}>
    <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 126 }]} showsVerticalScrollIndicator={false}>
      <View><Text style={styles.eyebrow}>ROUTE RECOMMENDATIONS</Text><Text accessibilityRole="header" style={styles.title}>Your preferences</Text><Text style={styles.subtitle}>Choose what SENSEA should prioritize when comparing available walking routes.</Text></View>

      <View style={styles.section}><Text style={styles.sectionTitle}>Primary priority</Text>{priorities.map(item => {
        const selected = preferences.routePriority === item.key;
        return <Pressable key={item.key} accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={() => void changePriority(item.key)} style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.pressed]}>
          <View style={[styles.optionIcon, selected && styles.optionIconSelected]}><Text style={[styles.optionGlyph, selected && styles.optionGlyphSelected]}>{item.icon}</Text></View>
          <View style={styles.optionCopy}><Text style={styles.optionTitle}>{item.title}</Text><Text style={styles.optionDescription}>{item.description}</Text></View>
          <View style={[styles.radio, selected && styles.radioSelected]}>{selected && <View style={styles.radioCore} />}</View>
        </Pressable>;
      })}</View>

      <View style={styles.section}><Text style={styles.sectionTitle}>Additional preferences</Text>
        <Toggle title="Avoid reported construction" description="Deprioritize routes with verified active construction." value={preferences.avoidConstruction} onChange={value => void changeConstruction(value)} />
        <Toggle title="Prefer well-lit paths" description="For this session; applies only when verified lighting data exists." value={preferences.preferWellLit} onChange={value => { preferences.setPreferWellLit(value); setStatus('Lighting preference set for this session.'); }} />
      </View>
      <Text accessibilityLiveRegion="polite" style={styles.saved}>{status}</Text>
      <View style={styles.notice}><Text style={styles.noticeIcon}>i</Text><Text style={styles.noticeText}>Preferences only affect ranking when the necessary route data is available. Unknown conditions remain labeled as unknown.</Text></View>
    </ScrollView>
    <BottomNav active="preferences" />
  </View>;
}

function Toggle({ title, description, value, onChange }: { title: string; description: string; value: boolean; onChange: (value: boolean) => void }) {
  return <View style={styles.toggleCard}><View style={styles.optionCopy}><Text style={styles.toggleTitle}>{title}</Text><Text style={styles.optionDescription}>{description}</Text></View><Switch accessibilityLabel={title} value={value} onValueChange={onChange} trackColor={{ false: colors.surfaceHighlight, true: colors.primary }} thumbColor={colors.background} /></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background }, container: { paddingHorizontal: spacing.lg, gap: spacing.xl }, eyebrow: { color: colors.primary, fontFamily: typography.family, fontSize: 11, fontWeight: '900', letterSpacing: 1.3, marginBottom: 6 }, title: { color: colors.text, fontFamily: typography.family, fontSize: 34, lineHeight: 41, fontWeight: '900', letterSpacing: -0.8 }, subtitle: { color: colors.muted, fontFamily: typography.family, fontSize: 15, lineHeight: 22, marginTop: 7 },
  section: { gap: 11 }, sectionTitle: { color: colors.textSoft, fontFamily: typography.family, fontSize: 16, fontWeight: '900', marginBottom: 2 }, option: { minHeight: 90, flexDirection: 'row', alignItems: 'center', gap: 13, padding: 14, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, optionSelected: { borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.primarySoft }, pressed: { opacity: 0.78 }, optionIcon: { width: 44, height: 44, borderRadius: 15, backgroundColor: colors.surfaceHighlight, alignItems: 'center', justifyContent: 'center' }, optionIconSelected: { backgroundColor: colors.surface }, optionGlyph: { color: colors.muted, fontSize: 22, fontWeight: '800' }, optionGlyphSelected: { color: colors.primary }, optionCopy: { flex: 1, gap: 4 }, optionTitle: { color: colors.text, fontFamily: typography.family, fontSize: 17, fontWeight: '900' }, optionDescription: { color: colors.muted, fontFamily: typography.family, fontSize: 12, lineHeight: 17 }, radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.mutedDark, alignItems: 'center', justifyContent: 'center' }, radioSelected: { borderColor: colors.primary }, radioCore: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  toggleCard: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, toggleTitle: { color: colors.text, fontFamily: typography.family, fontSize: 15, fontWeight: '800' }, saved: { color: colors.primary, fontFamily: typography.family, fontSize: 13, fontWeight: '800', textAlign: 'center' }, notice: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: radii.md, backgroundColor: colors.backgroundSoft, borderWidth: 1, borderColor: colors.border }, noticeIcon: { width: 20, height: 20, lineHeight: 20, borderRadius: 10, backgroundColor: colors.primarySoft, color: colors.primary, textAlign: 'center', fontWeight: '900' }, noticeText: { flex: 1, color: colors.muted, fontFamily: typography.family, fontSize: 12, lineHeight: 18 },
});
