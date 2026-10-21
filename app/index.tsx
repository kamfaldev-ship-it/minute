// Accueil : la règle + le chrono + le bouton d'enregistrement, puis les réunions par jour.

import { Link, Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../components/Button';
import { MeetingRow } from '../components/MeetingRow';
import { RecordButton } from '../components/RecordButton';
import { RecordRuler } from '../components/RecordRuler';
import { formatClock, groupByDay } from '../core/format';
import { searchMeetings, type SearchHit } from '../core/search';
import { useMeetings } from '../hooks/useMeetings';
import { ImportError, pickAndImportAudio } from '../services/importer';
import { RecorderError, startRecording, stopRecording, useRecorderState } from '../services/recorder';
import { loadSettings } from '../services/settings';
import { TOUCH, fonts, space, type, useColors } from '../theme/colors';

export default function Home() {
  const c = useColors();
  const router = useRouter();
  const meetings = useMeetings();
  const rec = useRecorderState();
  const isRecording = rec.phase === 'recording';
  const busy = rec.phase === 'starting' || rec.phase === 'stopping';
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;
  const hits = useMemo(() => searchMeetings(meetings, query), [meetings, query]);
  const snippets = useMemo(() => new Map(hits.map((h: SearchHit) => [h.meeting.id, h.snippet])), [hits]);
  const sections = useMemo(() => groupByDay(hits.map((h) => h.meeting)), [hits]);

  async function begin() {
    try {
      await startRecording();
    } catch (e) {
      Alert.alert('Enregistrement impossible', e instanceof RecorderError ? e.message : 'Erreur inconnue.');
    }
  }

  async function onRecordPress() {
    if (isRecording) {
      await stopRecording();
      return;
    }
    const settings = await loadSettings();

    // Sans clé Groq, rien ne sera transcrit : on prévient avant d'enregistrer.
    if (!settings.apiKey) {
      Alert.alert('Clé Groq manquante', 'Ajoutez votre clé Groq dans les Réglages pour transcrire vos réunions.', [
        { text: 'Plus tard', style: 'cancel' },
        { text: 'Ouvrir les Réglages', onPress: () => router.push('/settings') },
      ]);
      return;
    }
    if (settings.consentReminder) {
      Alert.alert('Consentement', 'Avez-vous prévenu les personnes présentes que la conversation est enregistrée ?', [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Oui, démarrer', onPress: () => void begin() },
      ]);
      return;
    }
    await begin();
  }

  async function onImport() {
    try {
      const id = await pickAndImportAudio();
      if (id) router.push({ pathname: '/meeting/[id]', params: { id } });
    } catch (e) {
      Alert.alert('Import impossible', e instanceof ImportError ? e.message : "Impossible d'importer ce fichier.");
    }
  }

  const header = (
    <View style={styles.header}>
      <Text
        style={[styles.clock, { color: isRecording ? c.record : c.text }]}
        accessibilityRole="timer"
        accessibilityLabel={`Durée ${formatClock(rec.elapsedSec)}`}
      >
        {formatClock(rec.elapsedSec)}
      </Text>
      <Text style={[styles.hint, { color: rec.interrupted ? c.danger : c.sub }]}>
        {rec.interrupted
          ? 'Interrompu par un appel ou Siri. Reprise automatique…'
          : isRecording
            ? 'Enregistrement en cours'
            : 'Prêt à enregistrer'}
      </Text>
      <View style={styles.ruler}>
        <RecordRuler level={rec.level} active={isRecording} elapsedSec={rec.elapsedSec} />
      </View>
      <RecordButton recording={isRecording} disabled={busy} onPress={() => void onRecordPress()} />
      <View style={styles.import}>
        <Button label="Importer un audio" variant="link" onPress={() => void onImport()} disabled={isRecording} />
      </View>
      {meetings.length > 0 && (
        <View style={styles.askRow}>
          <Button label="Poser une question à l'IA" variant="secondary" onPress={() => router.push('/ask')} />
        </View>
      )}
      {meetings.length > 0 && (
        <TextInput
          style={[styles.search, { color: c.text, backgroundColor: c.card, borderColor: c.border }]}
          value={query}
          onChangeText={setQuery}
          placeholder="Rechercher dans les réunions"
          placeholderTextColor={c.sub}
          returnKeyType="search"
          clearButtonMode="while-editing"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Rechercher dans les réunions"
        />
      )}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Minute',
          headerTitleStyle: { fontFamily: fonts.display, fontSize: type.title, fontWeight: '700', color: c.text },
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable style={styles.settings} accessibilityRole="button" accessibilityLabel="Réglages">
                <Text style={{ color: c.accent, fontSize: type.body, fontWeight: '600' }}>Réglages</Text>
              </Pressable>
            </Link>
          ),
        }}
      />
      <SectionList
        sections={sections}
        keyExtractor={(m) => m.id}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.day, { color: c.sub, backgroundColor: c.bg }]}>{section.title}</Text>
        )}
        renderItem={({ item, index, section }) => (
          <MeetingRow meeting={item} last={index === section.data.length - 1} snippet={searching ? snippets.get(item.id) : null} />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: c.sub }]}>
            {searching
              ? `Aucun résultat pour « ${query.trim()} ». Essayez un seul mot.`
              : "Aucune réunion pour l'instant. Touchez le bouton pour enregistrer la première."}
          </Text>
        }
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.m, paddingBottom: space.xl },
  header: { alignItems: 'center', paddingTop: space.m, paddingBottom: space.s },
  clock: { fontSize: type.clock, fontWeight: '200', fontVariant: ['tabular-nums'], letterSpacing: -1 },
  hint: { fontSize: type.label, marginTop: 2, textAlign: 'center' },
  ruler: { alignSelf: 'stretch', marginVertical: space.l },
  import: { alignSelf: 'stretch', marginTop: space.m },
  askRow: { alignSelf: 'stretch', marginTop: space.m },
  search: { alignSelf: 'stretch', minHeight: TOUCH, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, fontSize: type.body, marginTop: space.l },
  day: { fontSize: type.label, fontWeight: '700', marginTop: space.l, paddingBottom: space.xs, textTransform: 'capitalize' },
  empty: { textAlign: 'center', fontSize: type.label, marginTop: space.l, lineHeight: 22 },
  settings: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.s },
});
