import { Pressable, StyleSheet, View } from 'react-native';
import { useColors } from '../theme/colors';

/** Bouton rond : bleu au repos, rouge pendant l'enregistrement (carré = arrêter). */
export function RecordButton({
  recording,
  disabled,
  onPress,
}: {
  recording: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  const color = recording ? c.record : c.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={recording ? "Arrêter l'enregistrement" : "Démarrer l'enregistrement"}
      style={({ pressed }) => [
        styles.outer,
        { borderColor: color, opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
      ]}
    >
      <View style={[recording ? styles.square : styles.circle, { backgroundColor: color }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  outer: { width: 112, height: 112, borderRadius: 56, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  circle: { width: 84, height: 84, borderRadius: 42 },
  square: { width: 40, height: 40, borderRadius: 10 },
});
