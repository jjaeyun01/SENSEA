import { StyleSheet, Text, View } from 'react-native';

import { colors, typography } from '@/src/theme';

type Props = { compact?: boolean; inverted?: boolean };

export function BrandMark({ compact = false, inverted = false }: Props) {
  const ink = inverted ? colors.background : colors.text;
  return (
    <View accessible accessibilityRole="text" accessibilityLabel="SENSEA" style={styles.row}>
      <View style={[styles.pin, compact && styles.pinCompact]}>
        <View style={[styles.pinCore, compact && styles.pinCoreCompact, { backgroundColor: ink }]} />
      </View>
      <Text style={[styles.wordmark, compact && styles.wordmarkCompact, { color: ink }]}>SENSEA</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pin: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 7,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '45deg' }],
  },
  pinCompact: { width: 24, height: 24, borderRadius: 12, borderWidth: 6 },
  pinCore: { width: 5, height: 5, borderRadius: 3 },
  pinCoreCompact: { width: 4, height: 4 },
  wordmark: { fontFamily: typography.family, fontSize: 26, fontWeight: '900', letterSpacing: 0.8 },
  wordmarkCompact: { fontSize: 21 },
});
