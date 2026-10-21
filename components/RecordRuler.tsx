// La « règle » : élément signature de Minute.
// Pendant l'enregistrement, le niveau sonore dessine des traits qui défilent de droite
// à gauche ; un trait plus long marque chaque seconde, comme les graduations d'une règle.
// Au repos, la règle est plate. Si « Réduire les animations » est activé sur l'iPhone,
// elle reste figée.

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { useColors } from '../theme/colors';

const BARS = 56; // nombre de traits visibles
const TICKS_PER_SECOND = 4; // le chrono se met à jour toutes les 250 ms
const MAX_HEIGHT = 44;

export function RecordRuler({ level, active, elapsedSec }: { level: number; active: boolean; elapsedSec: number }) {
  const c = useColors();
  const [history, setHistory] = useState<number[]>(() => Array(BARS).fill(0));
  const counter = useRef(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!active) {
      counter.current = 0;
      setHistory(Array(BARS).fill(0));
      return;
    }
    if (reduceMotion) return;
    counter.current += 1;
    setHistory((h) => [...h.slice(1), level]);
    // On avance au rythme du chrono, pas du niveau : un nouveau trait par mise à jour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsedSec, active, reduceMotion]);

  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="image"
      accessibilityLabel={active ? 'Niveau sonore en direct' : 'Niveau sonore, enregistrement arrêté'}
    >
      {history.map((value, i) => {
        // Position de ce trait dans le temps : un trait sur 4 correspond à une seconde pleine.
        const age = BARS - 1 - i;
        const isSecond = (counter.current - age) % TICKS_PER_SECOND === 0;
        const height = 6 + (reduceMotion && active ? level : value) * (MAX_HEIGHT - 6);
        return (
          <View key={i} style={styles.slot}>
            <View
              style={{
                width: 3,
                height,
                borderRadius: 2,
                backgroundColor: active && value > 0.02 ? c.record : c.border,
              }}
            />
            <View style={{ width: 1.5, height: isSecond ? 10 : 5, marginTop: 6, backgroundColor: c.sub, opacity: isSecond ? 0.8 : 0.35 }} />
          </View>
        );
      })}
      {/* repère fixe : l'instant présent */}
      <View pointerEvents="none" style={[styles.now, { backgroundColor: active ? c.record : c.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { height: MAX_HEIGHT + 28, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', overflow: 'hidden' },
  slot: { alignItems: 'center', justifyContent: 'flex-end', flex: 1 },
  now: { position: 'absolute', right: 0, bottom: 0, top: 0, width: 2, borderRadius: 1 },
});
