import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDurationShort, formatTime } from '../core/format';
import type { Meeting } from '../core/types';
import { TOUCH, fonts, space, type, useColors } from '../theme/colors';
import { StatusMark } from './StatusMark';

/** Ligne de la liste : titre, début du résumé, heure et durée. Séparée par un filet, sans carte. */
export function MeetingRow({ meeting, last, snippet }: { meeting: Meeting; last: boolean; snippet?: string | null }) {
  const c = useColors();
  const excerpt = snippet ?? meeting.summary?.resume?.split('\n')[0];
  const meta = [formatTime(meeting.createdAt), meeting.durationSec > 0 ? formatDurationShort(meeting.durationSec) : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <Link href={{ pathname: '/meeting/[id]', params: { id: meeting.id } }} asChild>
      <Pressable
        accessibilityRole="button"
        style={StyleSheet.flatten([
          styles.row,
          { borderBottomColor: c.border, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth },
        ])}
      >
        <Text style={[styles.title, { color: c.text, fontFamily: fonts.display }]} numberOfLines={2}>
          {meeting.title}
        </Text>
        {excerpt ? (
          <Text style={[styles.excerpt, { color: c.sub }]} numberOfLines={2}>
            {excerpt}
          </Text>
        ) : null}
        <View style={styles.meta}>
          <Text style={[styles.metaText, { color: c.sub }]}>{meta}</Text>
          <StatusMark status={meeting.status} />
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: TOUCH, paddingVertical: space.m },
  title: { fontSize: type.title - 2, fontWeight: '600', lineHeight: 26 },
  excerpt: { fontSize: type.label, lineHeight: 21, marginTop: space.xs },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.s, gap: space.m },
  metaText: { fontSize: type.small, fontVariant: ['tabular-nums'] },
});
