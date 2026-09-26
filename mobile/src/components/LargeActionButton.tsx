import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityRole,
} from 'react-native';

import { colors } from '@/src/theme';

type Props = {
  label: string;
  onPress: () => void;
  accessibilityHint?: string;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  icon?: ReactNode;
  accessibilityRole?: AccessibilityRole;
};

export function LargeActionButton({
  label,
  onPress,
  accessibilityHint,
  disabled = false,
  loading = false,
  variant = 'primary',
  icon,
  accessibilityRole = 'button',
}: Props) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
      ]}
    >
      <View style={styles.content} accessible={false}>
        {loading ? <ActivityIndicator color={variant === 'primary' ? colors.primaryText : colors.text} /> : icon}
        <Text style={[styles.label, variant === 'primary' ? styles.primaryLabel : styles.lightLabel]}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 64,
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 16,
    justifyContent: 'center',
    borderWidth: 2,
  },
  primary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  secondary: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  danger: {
    backgroundColor: '#7F1D1D',
    borderColor: colors.danger,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  label: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  primaryLabel: {
    color: colors.primaryText,
  },
  lightLabel: {
    color: colors.text,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
  disabled: {
    opacity: 0.48,
  },
});
