import { Image, StyleSheet, View } from 'react-native';

type Props = { compact?: boolean; inverted?: boolean };

export function BrandMark({ compact = false, inverted = false }: Props) {
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="SENSEA" style={[styles.row, inverted && styles.inverted]}>
      <Image source={require('../../assets/sensea-logo.png')} resizeMode="contain" style={compact ? styles.compact : styles.logo} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', justifyContent: 'center' },
  logo: { width: 148, height: 110 },
  compact: { width: 96, height: 44 },
  inverted: { backgroundColor: '#F7FAF9', borderRadius: 8 },

});
