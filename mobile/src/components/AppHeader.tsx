import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, typography } from '@/src/theme';

type Props = { title: string; eyebrow?: string; onBack?: () => void; actionLabel?: string; onAction?: () => void };

export function AppHeader({ title, eyebrow, onBack, actionLabel, onAction }: Props) {
  return (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        {onBack && <Pressable accessibilityRole="button" accessibilityLabel="Go back" hitSlop={12} onPress={onBack} style={styles.iconButton}><Text style={styles.icon}>‹</Text></Pressable>}
        <View style={styles.copy}>
          {eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        </View>
        {actionLabel && onAction && <Pressable accessibilityRole="button" accessibilityLabel={actionLabel} hitSlop={12} onPress={onAction} style={styles.action}><Text style={styles.actionText}>{actionLabel}</Text></Pressable>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: 8, paddingBottom: 18 },
  titleRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 12 },
  copy: { flex: 1 },
  eyebrow: { color: colors.primary, fontFamily: typography.family, fontSize: 13, fontWeight: '800', letterSpacing: 1.3, textTransform: 'uppercase', marginBottom: 2 },
  title: { color: colors.text, fontFamily: typography.family, fontSize: 30, fontWeight: '900', letterSpacing: -0.7 },
  iconButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  icon: { color: colors.primary, fontSize: 36, lineHeight: 38, marginTop: -3 },
  action: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 12 },
  actionText: { color: colors.primary, fontFamily: typography.family, fontWeight: '800', fontSize: 16 },
});
