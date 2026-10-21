// Section « Audio original » : une ligne par fichier audio de la réunion.

import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { formatDurationShort } from '../core/format';
import type { Meeting, Segment } from '../core/types';
import { listSegments, subscribeDb } from '../services/db';
import { ExportError, shareSegmentAudio } from '../services/exportAudio';
import { fileExists, fileSizeMb } from '../services/files';
import { space, type, useColors } from '../theme/colors';
import { Button } from './Button';

/** Charge les segments d'une réunion et les garde à jour. */
export function useSegments(meetingId: string): Segment[] {
  const [segments, setSegments] = useState<Segment[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => void listSegments(meetingId).then((s) => alive && setSegments(s));
    load();
    const unsubscribe = subscribeDb(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [meetingId]);
  return segments;
}

/** Exporte un segment et affiche une erreur claire en cas d'échec. */
export async function exportSegment(title: string, segment: Segment, total: number) {
  try {
    await shareSegmentAudio(title, segment, total);
  } catch (e) {
    Alert.alert('Export impossible', e instanceof ExportError ? e.message : "Impossible d'exporter cet audio.");
  }
}

export function AudioParts({ meeting, segments }: { meeting: Meeting; segments: Segment[] }) {
  const c = useColors();
  if (segments.length === 0) return null;
  return (
    <View style={{ marginTop: space.l }}>
      <Text style={[styles.title, { color: c.text }]}>Audio original</Text>
      {segments.map((segment) => {
        const exists = fileExists(segment.uri);
        const label = segments.length > 1 ? `Partie ${segment.idx + 1}` : 'Enregistrement';
        const details = exists
          ? [segment.durationSec > 0 ? formatDurationShort(segment.durationSec) : null, `${fileSizeMb(segment.uri).toFixed(1)} Mo`]
              .filter(Boolean)
              .join(' · ')
          : 'Fichier introuvable';
        return (
          <View key={segment.id} style={[styles.row, { borderBottomColor: c.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: c.text }]}>{label}</Text>
              <Text style={[styles.details, { color: exists ? c.sub : c.danger }]}>{details}</Text>
            </View>
            <View style={{ minWidth: 120 }}>
              <Button
                label="Exporter"
                disabled={!exists}
                onPress={() => void exportSegment(meeting.title, segment, segments.length)}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: type.body, fontWeight: '700', marginBottom: space.s },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.s, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { fontSize: type.body, fontWeight: '500' },
  details: { fontSize: type.small, marginTop: 2, fontVariant: ['tabular-nums'] },
});
