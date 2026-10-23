// Détail d'une réunion : synthèse, transcription, audio d'origine et export.

import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TimeTag } from '../../components/TimeTag';
import { AudioParts, useSegments } from '../../components/AudioParts';
import { Button } from '../../components/Button';
import { showExportMenu } from '../../components/ExportMenu';
import { StatusMark } from '../../components/StatusMark';
import { formatDate, formatDurationShort } from '../../core/format';
import { sectionGroup } from '../../core/markdown';
import { formatStamp, lineIndexAt, parseTranscriptLines } from '../../core/timestamps';
import type { Meeting, Task } from '../../core/types';
import { useMeeting } from '../../hooks/useMeetings';
import { deleteMeetingRows, listSegments, updateMeeting } from '../../services/db';
import { deleteFile } from '../../services/files';
import { retryMeeting } from '../../services/pipeline';
import { TOUCH, fonts, space, type, useColors } from '../../theme/colors';

export default function MeetingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const meeting = useMeeting(id);
  const segments = useSegments(id);
  const router = useRouter();
  const c = useColors();
  const [tab, setTab] = useState<'summary' | 'transcript'>('summary');
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const transcriptTop = useRef(0);
  const lineTops = useRef<Record<number, number>>({});
  const [highlight, setHighlight] = useState<number | null>(null);

  if (meeting === undefined) return null;
  if (meeting === null) {
    return <Text style={[styles.empty, { color: c.sub }]}>Cette réunion n'existe plus.</Text>;
  }

  /** Saisie d'un nouveau titre (fenêtre native iOS). */
  function rename() {
    Alert.prompt(
      'Renommer la réunion',
      undefined,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Enregistrer',
          onPress: (value?: string) => {
            const title = (value ?? '').trim();
            if (title && title !== meeting!.title) void updateMeeting(meeting!.id, { title, titleEdited: true });
          },
        },
      ],
      'plain-text',
      meeting!.title
    );
  }

  function confirmDelete() {
    Alert.alert('Supprimer cette réunion ?', "L'audio, la transcription et la synthèse seront effacés.", [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          for (const s of await listSegments(meeting!.id)) deleteFile(s.uri);
          await deleteMeetingRows(meeting!.id);
          router.back();
        },
      },
    ]);
  }

  /** Ouvre la transcription et fait défiler jusqu'à la ligne de la minute demandée. */
  function jumpTo(sec: number) {
    const lines = parseTranscriptLines(meeting!.transcript ?? '');
    if (lines.length === 0) return;
    const index = lineIndexAt(lines, sec);
    setHighlight(index);
    setTab('transcript');
    // On attend que les lignes soient affichées et mesurées.
    setTimeout(() => {
      const y = transcriptTop.current + (lineTops.current[index] ?? 0);
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
    }, 120);
  }

  async function toggleTask(index: number) {
    if (!meeting?.summary) return;
    const taches = meeting.summary.taches.map((t, i) => (i === index ? { ...t, fait: !t.fait } : t));
    await updateMeeting(meeting.id, { summary: { ...meeting.summary, taches } });
    void Haptics.selectionAsync();
  }

  return (
    <ScrollView ref={scrollRef} style={{ backgroundColor: c.bg }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: '' }} />
      <Pressable
        onPress={rename}
        accessibilityRole="button"
        accessibilityLabel={`Titre : ${meeting.title}. Toucher pour renommer`}
        accessibilityHint="Ouvre la saisie d'un nouveau titre"
      >
        <Text style={[styles.title, { color: c.text, fontFamily: fonts.display }]}>{meeting.title}</Text>
        <Text style={[styles.renameHint, { color: c.accent }]}>Renommer</Text>
      </Pressable>
      <Text style={[styles.meta, { color: c.sub }]}>
        {formatDate(meeting.createdAt)}
        {meeting.durationSec > 0 ? ` · ${formatDurationShort(meeting.durationSec)}` : ''}
      </Text>
      <View style={{ marginTop: space.s }}>
        <StatusMark status={meeting.status} />
      </View>

      {meeting.error ? (
        <View style={[styles.errorBox, { borderColor: c.danger }]}>
          <Text style={[styles.error, { color: c.danger }]}>{meeting.error}</Text>
        </View>
      ) : null}
      {meeting.status === 'error' ? (
        <View style={{ marginTop: space.m }}>
          <Button label="Réessayer" variant="primary" onPress={() => void retryMeeting(meeting.id)} />
        </View>
      ) : null}

      <View style={[styles.tabs, { borderBottomColor: c.border }]} accessibilityRole="tablist">
        {(['summary', 'transcript'] as const).map((t) => {
          const selected = tab === t;
          return (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              style={[styles.tab, { borderBottomColor: selected ? c.accent : 'transparent' }]}
            >
              <Text style={{ color: selected ? c.text : c.sub, fontWeight: selected ? '700' : '500', fontSize: type.body }}>
                {t === 'summary' ? 'Synthèse' : 'Transcription'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {tab === 'summary' ? (
        <SummaryTab meeting={meeting} onToggleTask={(i) => void toggleTask(i)} onJump={jumpTo} />
      ) : (
        <View style={{ marginTop: space.m }} onLayout={(e) => (transcriptTop.current = e.nativeEvent.layout.y)}>
          {meeting.transcript ? (
            parseTranscriptLines(meeting.transcript).map((line, i) => (
              <View
                key={i}
                onLayout={(e) => (lineTops.current[i] = e.nativeEvent.layout.y)}
                style={[styles.line, highlight === i && { backgroundColor: c.card, borderLeftColor: c.accent }]}
              >
                {line.sec !== undefined && <Text style={[styles.stamp, { color: c.accent }]}>{formatStamp(line.sec)}</Text>}
                <Text selectable style={[styles.body, { color: c.text, flex: 1, marginBottom: 0 }]}>{line.text}</Text>
              </View>
            ))
          ) : (
            <Text style={[styles.body, { color: c.text }]}>La transcription apparaîtra ici automatiquement.</Text>
          )}
        </View>
      )}

      <AudioParts meeting={meeting} segments={segments} />

      <View style={styles.actions}>
        <Button label="Exporter" variant="primary" onPress={() => showExportMenu(meeting, segments)} />
        <Button
          label="Poser une question sur cette réunion"
          disabled={!meeting.summary && !meeting.transcript}
          onPress={() => router.push({ pathname: '/ask', params: { meetingId: meeting.id } })}
        />
        <Button label="Supprimer la réunion" variant="danger" onPress={confirmDelete} />
      </View>
    </ScrollView>
  );
}

function SummaryTab({ meeting, onToggleTask, onJump }: { meeting: Meeting; onToggleTask: (i: number) => void; onJump: (sec: number) => void }) {
  const c = useColors();
  const s = meeting.summary;
  if (!s) {
    return (
      <Text style={[styles.empty, { color: c.sub }]}>
        {meeting.status === 'error'
          ? "La synthèse n'a pas pu être créée. Touchez « Réessayer »."
          : 'La synthèse arrive toute seule. Vous pouvez quitter cet écran.'}
      </Text>
    );
  }
  return (
    <View>
      <Section title="Résumé">
        <Text style={[styles.body, { color: c.text, fontFamily: fonts.display, lineHeight: 28 }]}>{s.resume}</Text>
      </Section>
      <Section title="Prochaines actions">
        {s.taches.length === 0 && (
          <Text style={[styles.body, { color: c.sub }]}>Aucune action repérée dans cette réunion.</Text>
        )}
        {groupTasks(s.taches).map((group) => (
          <View key={group.owner} style={{ marginTop: space.xs }}>
            {groupTasks(s.taches).length > 1 && (
              <Text style={[styles.owner, { color: c.accent }]}>{group.owner}</Text>
            )}
            {group.items.map(({ task: t, index: i }) => (
              <Pressable
                key={i}
                onPress={() => onToggleTask(i)}
                style={styles.task}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: !!t.fait }}
              >
                <View style={[styles.box, { borderColor: c.accent, backgroundColor: t.fait ? c.accent : 'transparent' }]}>
                  {t.fait ? <View style={[styles.tick, { borderColor: c.onAccent }]} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.body, { color: t.fait ? c.sub : c.text, textDecorationLine: t.fait ? 'line-through' : 'none' }]}>
                    {t.action}
                  </Text>
                  {t.echeance && <Text style={[styles.meta, { color: c.sub }]}>Pour : {t.echeance}</Text>}
                  {t.minute !== undefined && (
                    <View style={{ marginTop: space.xs }}>
                      <TimeTag sec={t.minute} onPress={onJump} />
                    </View>
                  )}
                </View>
              </Pressable>
            ))}
          </View>
        ))}
      </Section>
      {s.fil_conducteur && (
        <Section title="Fil conducteur">
          <Text style={[styles.topicTitle, { color: c.text, fontFamily: fonts.display, fontSize: type.title, lineHeight: 30 }]}>
            {s.fil_conducteur.titre}
          </Text>
          {s.fil_conducteur.description ? (
            <Text style={[styles.body, { color: c.text, marginTop: space.xs }]}>{s.fil_conducteur.description}</Text>
          ) : null}
          {s.fil_conducteur.minutes.length > 0 && (
            <View style={styles.tags}>
              {s.fil_conducteur.minutes.map((m, i) => (
                <TimeTag key={i} sec={m} onPress={onJump} />
              ))}
            </View>
          )}
        </Section>
      )}
      {[...new Set((s.sections ?? []).map(sectionGroup))].map((group) => (
        <Section key={group} title={group}>
          {(s.sections ?? [])
            .filter((x) => sectionGroup(x) === group)
            .map((x, i) => (
              <View key={i} style={styles.topic}>
                <View style={styles.topicHead}>
                  <Text style={[styles.topicTitle, { color: c.text }]}>{x.titre}</Text>
                  {x.role && <Text style={[styles.meta, { color: c.sub, marginTop: 0 }]}>{x.rubrique}</Text>}
                  {x.minute !== undefined && <TimeTag sec={x.minute} onPress={onJump} />}
                </View>
                {x.details.map((d, k) => (
                  <Text key={k} style={[styles.body, { color: c.text }]}>• {d}</Text>
                ))}
              </View>
            ))}
        </Section>
      ))}
      {s.points_cles.length > 0 && !(s.sections ?? []).length && (
        <Section title="Points clés">
          {s.points_cles.map((p, i) => (
            <Text key={i} style={[styles.body, { color: c.text }]}>• {p}</Text>
          ))}
        </Section>
      )}
      {s.decisions.length > 0 && (
        <Section title="Décisions">
          {s.decisions.map((d, i) => (
            <Text key={i} style={[styles.body, { color: c.text }]}>• {d}</Text>
          ))}
        </Section>
      )}
    </View>
  );
}

/** Regroupe les tâches par responsable (en gardant leur rang d'origine pour pouvoir les cocher). */
function groupTasks(tasks: Task[]): { owner: string; items: { task: Task; index: number }[] }[] {
  const groups = new Map<string, { task: Task; index: number }[]>();
  tasks.forEach((task, index) => {
    const owner = task.responsable?.trim() || 'À attribuer';
    groups.set(owner, [...(groups.get(owner) ?? []), { task, index }]);
  });
  // « À attribuer » en dernier.
  return [...groups.entries()]
    .sort(([a], [b]) => (a === 'À attribuer' ? 1 : b === 'À attribuer' ? -1 : 0))
    .map(([owner, items]) => ({ owner, items }));
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={{ marginTop: space.l }}>
      <Text style={[styles.sectionTitle, { color: c.text }]}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.m, paddingBottom: space.xl * 2 },
  title: { fontSize: type.headline, fontWeight: '700', lineHeight: 36 },
  renameHint: { fontSize: type.small, fontWeight: '600', marginTop: space.xs },
  meta: { fontSize: type.small, marginTop: space.xs, fontVariant: ['tabular-nums'] },
  errorBox: { borderLeftWidth: 3, paddingLeft: space.m, marginTop: space.m },
  error: { fontSize: type.label, lineHeight: 21 },
  tabs: { flexDirection: 'row', gap: space.l, borderBottomWidth: StyleSheet.hairlineWidth, marginTop: space.l },
  tab: { minHeight: 48, justifyContent: 'center', borderBottomWidth: 2, marginBottom: -StyleSheet.hairlineWidth },
  sectionTitle: { fontSize: type.body, fontWeight: '700', marginBottom: space.xs },
  body: { fontSize: type.body, lineHeight: 25, marginBottom: space.xs },
  empty: { fontSize: type.body, textAlign: 'center', margin: space.l, lineHeight: 23 },
  task: { flexDirection: 'row', gap: space.m - 4, minHeight: TOUCH, paddingVertical: space.s, alignItems: 'flex-start' },
  box: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  tick: { width: 7, height: 13, borderRightWidth: 2.5, borderBottomWidth: 2.5, transform: [{ rotate: '40deg' }], marginTop: -2 },
  owner: { fontSize: type.label, fontWeight: '700', marginTop: space.s },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.s },
  topic: { marginTop: space.s },
  topicHead: { gap: space.xs, marginBottom: space.xs },
  topicTitle: { fontSize: type.body, fontWeight: '700', lineHeight: 24 },
  line: { flexDirection: 'row', gap: space.s + 4, paddingVertical: space.xs + 2, paddingLeft: space.s, borderLeftWidth: 3, borderLeftColor: 'transparent' },
  stamp: { fontSize: type.small, fontWeight: '600', fontVariant: ['tabular-nums'], width: 52, paddingTop: 4 },
  actions: { gap: space.s + 2, marginTop: space.xl },
});
