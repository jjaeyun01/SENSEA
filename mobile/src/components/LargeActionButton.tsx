import { recordEvent } from '@/src/navigation/audit';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityRole,
} from 'react-native';

import { colors, radii, typography } from '@/src/theme';

type Props = {
  label: string;
  onPress: () => void;
  accessibilityHint?: string;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
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
      onPress={() => { recordEvent("touch", label); onPress(); }}
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
      ]}
    >
      <View style={styles.content} accessible={false}>
        {loading ? <ActivityIndicator color={variant === 'primary' ? colors.primaryText : colors.text} /> : icon}
        <Text style={[styles.label, variant === 'primary' ? styles.primaryLabel : styles.lightLabel]} numberOfLines={2}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 60,
    borderRadius: radii.pill,
    paddingHorizontal: 20,
    paddingVertical: 16,
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  primary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  danger: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: colors.primary,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  label: {
    fontFamily: typography.family,
    fontSize: 18,
    fontWeight: '800',
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
