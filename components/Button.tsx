import { Pressable, StyleSheet, Text } from 'react-native';
import { TOUCH, type, useColors } from '../theme/colors';

/** Bouton à grande zone de toucher. Un seul `primary` par écran. */
export function Button({
  label,
  onPress,
  variant = 'secondary',
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'link';
  disabled?: boolean;
}) {
  const c = useColors();
  const primary = variant === 'primary';
  const link = variant === 'link';
  const fg = primary ? c.onAccent : variant === 'danger' ? c.danger : link ? c.accent : c.text;
  const border = primary ? c.accent : variant === 'danger' ? c.danger : c.border;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.button,
        link ? styles.link : { borderWidth: 1, borderColor: border, backgroundColor: primary ? c.accent : c.card },
        { opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
      ]}
    >
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: TOUCH, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  link: { minHeight: 48 },
  label: { fontSize: type.body, fontWeight: '600' },
});
