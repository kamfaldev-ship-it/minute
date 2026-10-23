// Questions à l'IA : sur toutes les réunions, ou sur une seule (paramètre `meetingId`).

import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatDate } from '../core/format';
import type { AskResult, AskSource } from '../core/ask';
import { errorMessage } from '../core/retry';
import { useMeeting } from '../hooks/useMeetings';
import { askAboutMeetings } from '../services/ask';
import { TOUCH, fonts, space, type, useColors } from '../theme/colors';

interface Exchange {
  question: string;
  answer?: string;
  sources?: AskSource[];
  error?: string;
}

const SUGGESTIONS_ALL = [
  "Qu'a-t-on décidé cette semaine ?",
  'Quelles tâches me restent à faire ?',
  'Que faut-il retenir de ma dernière réunion ?',
];
const SUGGESTIONS_ONE = ['Quelles sont les décisions prises ?', 'Qui doit faire quoi, et pour quand ?', "Qu'est-ce qui reste ouvert ?"];

export default function AskScreen() {
  const { meetingId } = useLocalSearchParams<{ meetingId?: string }>();
  const meeting = useMeeting(meetingId ?? '');
  const c = useColors();
  const [input, setInput] = useState('');
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [loading, setLoading] = useState(false);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  async function send(text: string) {
    const question = text.trim();
    if (!question || loading) return;
    setInput('');
    setLoading(true);
    const index = exchanges.length;
    setExchanges((prev) => [...prev, { question }]);
    try {
      const history = exchanges.filter((e) => e.answer).map((e) => ({ question: e.question, answer: e.answer! }));
      const result: AskResult = await askAboutMeetings(question, history, meetingId);
      setExchanges((prev) => prev.map((e, i) => (i === index ? { ...e, answer: result.answer, sources: result.sources } : e)));
    } catch (e) {
      setExchanges((prev) => prev.map((x, i) => (i === index ? { ...x, error: errorMessage(e) } : x)));
    } finally {
      setLoading(false);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 100);
    }
  }

  const scope = meetingId ? (meeting ? meeting.title : 'cette réunion') : 'toutes vos réunions';
  const suggestions = meetingId ? SUGGESTIONS_ONE : SUGGESTIONS_ALL;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Questions' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <ScrollView
          ref={scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        >
          <Text style={[styles.scope, { color: c.sub }]}>Question sur {scope}</Text>

          {exchanges.length === 0 && (
            <View style={{ marginTop: space.m }}>
              <Text style={[styles.intro, { color: c.text, fontFamily: fonts.display }]}>
                Posez une question, l'IA répond à partir de vos comptes rendus et transcriptions.
              </Text>
              {suggestions.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => void send(s)}
                  accessibilityRole="button"
                  style={[styles.suggestion, { borderBottomColor: c.border }]}
                >
                  <Text style={{ color: c.accent, fontSize: type.body, fontWeight: '500' }}>{s}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {exchanges.map((e, i) => (
            <View key={i} style={styles.exchange}>
              <Text style={[styles.question, { color: c.text, fontFamily: fonts.display }]}>{e.question}</Text>
              {e.answer ? (
                <>
                  <Text selectable style={[styles.answer, { color: c.text }]}>{e.answer}</Text>
                  {e.sources && e.sources.length > 0 && (
                    <View style={styles.sources}>
                      <Text style={[styles.sourcesTitle, { color: c.sub }]}>Réunions consultées</Text>
                      {e.sources.map((s) => (
                        <Link key={s.id} href={{ pathname: '/meeting/[id]', params: { id: s.id } }} asChild>
                          <Pressable accessibilityRole="link" style={styles.source}>
                            <Text style={{ color: c.accent, fontSize: type.label }}>
                              {s.title} · {formatDate(s.createdAt)}
                            </Text>
                          </Pressable>
                        </Link>
                      ))}
                    </View>
                  )}
                </>
              ) : e.error ? (
                <View style={[styles.errorBox, { borderColor: c.danger }]}>
                  <Text style={{ color: c.danger, fontSize: type.label, lineHeight: 21 }}>{e.error}</Text>
                </View>
              ) : (
                <View style={styles.loading}>
                  <ActivityIndicator color={c.sub} />
                  <Text style={{ color: c.sub, fontSize: type.label }}>Recherche dans les réunions…</Text>
                </View>
              )}
            </View>
          ))}
        </ScrollView>

        <View style={[styles.bar, { borderTopColor: c.border, backgroundColor: c.bg }]}>
          <TextInput
            style={[styles.input, { color: c.text, backgroundColor: c.card, borderColor: c.border }]}
            value={input}
            onChangeText={setInput}
            placeholder="Votre question"
            placeholderTextColor={c.sub}
            returnKeyType="send"
            onSubmitEditing={() => void send(input)}
            editable={!loading}
            accessibilityLabel="Votre question"
          />
          <Pressable
            onPress={() => void send(input)}
            disabled={loading || !input.trim()}
            accessibilityRole="button"
            accessibilityLabel="Envoyer la question"
            style={[styles.send, { backgroundColor: c.accent, opacity: loading || !input.trim() ? 0.4 : 1 }]}
          >
            <Text style={{ color: c.onAccent, fontWeight: '700', fontSize: type.body }}>Envoyer</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.m, paddingBottom: space.xl },
  scope: { fontSize: type.small },
  intro: { fontSize: type.title - 2, lineHeight: 28, marginBottom: space.m },
  suggestion: { minHeight: TOUCH, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  exchange: { marginTop: space.l },
  question: { fontSize: type.title - 2, fontWeight: '700', lineHeight: 26 },
  answer: { fontSize: type.body, lineHeight: 26, marginTop: space.s },
  sources: { marginTop: space.m },
  sourcesTitle: { fontSize: type.small, fontWeight: '600', marginBottom: 2 },
  source: { minHeight: 44, justifyContent: 'center' },
  loading: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.m },
  errorBox: { borderLeftWidth: 3, paddingLeft: space.m, marginTop: space.s },
  bar: { flexDirection: 'row', gap: space.s, padding: space.m, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: TOUCH, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, fontSize: type.body },
  send: { minHeight: TOUCH, borderRadius: 14, paddingHorizontal: space.m, alignItems: 'center', justifyContent: 'center' },
});
