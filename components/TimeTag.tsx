// Pastille de minute ("12:35") : un toucher ouvre la transcription à cet endroit.

import { Pressable, StyleSheet, Text } from 'react-native';
import { formatStamp } from '../core/timestamps';
import { type, useColors } from '../theme/colors';

export function TimeTag({ sec, onPress }: { sec: number; onPress: (sec: number) => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={() => onPress(sec)}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={`Minute ${formatStamp(sec)}`}
      accessibilityHint="Ouvre la transcription à ce moment"
      style={({ pressed }) => [styles.tag, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={[styles.text, { color: c.accent }]}>{formatStamp(sec)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tag: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  text: { fontSize: type.small, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
