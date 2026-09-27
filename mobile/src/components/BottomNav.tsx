import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, typography } from '@/src/theme';

export type MainTab = 'home' | 'map' | 'preferences' | 'profile';

const tabs: { key: MainTab; label: string; icon: string; href: '/' | '/map' | '/preferences' | '/profile' }[] = [
  { key: 'home', label: 'Home', icon: '⌂', href: '/' },
  { key: 'map', label: 'Map', icon: '⌖', href: '/map' },
  { key: 'preferences', label: 'Preferences', icon: '≋', href: '/preferences' },
  { key: 'profile', label: 'Profile', icon: '○', href: '/profile' },
];

export function BottomNav({ active }: { active: MainTab }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return <View accessibilityRole="tablist" style={[styles.shell, { paddingBottom: Math.max(insets.bottom, 10) }]}>
    <View style={styles.bar}>{tabs.map(tab => {
      const selected = tab.key === active;
      return <Pressable key={tab.key} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={tab.label} onPress={() => { if (!selected) router.replace(tab.href); }} style={({ pressed }) => [styles.item, selected && styles.itemActive, pressed && styles.itemPressed]}>
        <Text style={[styles.icon, selected && styles.iconActive]}>{tab.icon}</Text>
        <Text numberOfLines={1} style={[styles.label, selected && styles.labelActive]}>{tab.label}</Text>
      </Pressable>;
    })}</View>
  </View>;
}

const styles = StyleSheet.create({
  shell: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingTop: 8, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border },
  bar: { minHeight: 64, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 22, borderWidth: 1, borderColor: colors.border, padding: 5 },
  item: { flex: 1, minHeight: 52, borderRadius: 17, alignItems: 'center', justifyContent: 'center', gap: 2 },
  itemActive: { backgroundColor: colors.primarySoft }, itemPressed: { opacity: 0.72 },
  icon: { color: colors.muted, fontSize: 22, lineHeight: 24, fontWeight: '700' }, iconActive: { color: colors.primary },
  label: { color: colors.muted, fontFamily: typography.family, fontSize: 10, fontWeight: '700' }, labelActive: { color: colors.primary, fontWeight: '900' },
});
