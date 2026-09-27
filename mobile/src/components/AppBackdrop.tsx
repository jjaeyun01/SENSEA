import { StyleSheet, View } from 'react-native';

import { colors } from '@/src/theme';

export function AppBackdrop() {
  return (
    <View pointerEvents="none" accessible={false} style={StyleSheet.absoluteFill}>
      <View style={styles.topGlow} />
      <View style={styles.sideGlow} />
      <View style={styles.gridVerticalOne} />
      <View style={styles.gridVerticalTwo} />
      <View style={styles.gridHorizontalOne} />
      <View style={styles.gridHorizontalTwo} />
      <View style={styles.orbit} />
      <View style={styles.orbitDot} />
    </View>
  );
}

const gridBase = {
  position: 'absolute' as const,
  backgroundColor: 'rgba(103, 166, 255, 0.055)',
};

const styles = StyleSheet.create({
  topGlow: {
    position: 'absolute',
    width: 540,
    height: 540,
    borderRadius: 270,
    top: -310,
    right: -160,
    backgroundColor: 'rgba(124, 247, 199, 0.11)',
  },
  sideGlow: {
    position: 'absolute',
    width: 420,
    height: 420,
    borderRadius: 210,
    left: -270,
    top: '48%',
    backgroundColor: 'rgba(103, 166, 255, 0.10)',
  },
  gridVerticalOne: { ...gridBase, width: 1, top: 0, bottom: 0, left: '24%' },
  gridVerticalTwo: { ...gridBase, width: 1, top: 0, bottom: 0, right: '20%' },
  gridHorizontalOne: { ...gridBase, height: 1, left: 0, right: 0, top: '30%' },
  gridHorizontalTwo: { ...gridBase, height: 1, left: 0, right: 0, bottom: '18%' },
  orbit: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    right: 34,
    bottom: 46,
  },
  orbitDot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
    right: 117,
    bottom: 221,
  },
});
