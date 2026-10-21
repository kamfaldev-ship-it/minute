import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { MeetingStatus } from '../core/types';
import { type, useColors } from '../theme/colors';

const LABELS: Record<MeetingStatus, string> = {
  recording: 'Enregistrement en cours',
  transcribing: 'Transcription en cours',
  summarizing: 'Synthèse en cours',
  done: 'Terminé',
  error: 'À relancer',
};

/** Pastille + texte : l'état n'est jamais indiqué par la couleur seule. Rien à afficher quand c'est terminé. */
export function StatusMark({ status, showDone = false }: { status: MeetingStatus; showDone?: boolean }) {
  const c = useColors();
  if (status === 'done' && !showDone) return null;
  const busy = status === 'transcribing' || status === 'summarizing';
  const color = status === 'error' ? c.danger : status === 'recording' ? c.record : status === 'done' ? c.ok : c.sub;
  return (
    <View style={styles.row} accessible accessibilityLabel={LABELS[status]}>
      {busy ? (
        <ActivityIndicator size="small" color={c.sub} />
      ) : status === 'done' ? (
        <View style={[styles.check, { borderColor: color }]} />
      ) : (
        <View style={[styles.dot, { backgroundColor: color }]} />
      )}
      <Text style={[styles.text, { color }]}>{LABELS[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  // coche dessinée : un coin tourné de 45°
  check: { width: 6, height: 10, borderRightWidth: 2, borderBottomWidth: 2, transform: [{ rotate: '40deg' }], marginRight: 2 },
  text: { fontSize: type.small, fontWeight: '500' },
});
