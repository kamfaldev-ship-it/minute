// Réglages : clé Groq, langue, rappel de consentement, webhook facultatif.

import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Button } from '../components/Button';
import type { Language } from '../core/types';
import { loadSettings, saveSettings, type Settings } from '../services/settings';
import { TOUCH, space, type, useColors } from '../theme/colors';

export default function SettingsScreen() {
  const c = useColors();
  const [s, setS] = useState<Settings | null>(null);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    void loadSettings().then(setS);
  }, []);

  if (!s) return null;

  const input = [styles.input, { color: c.text, backgroundColor: c.card, borderColor: c.border }];

  async function save() {
    await saveSettings(s!);
    Alert.alert('Enregistré', 'Vos réglages sont sauvegardés.');
  }

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={[styles.label, { color: c.text }]}>Clé Groq</Text>
      <TextInput
        style={input}
        value={s.apiKey}
        onChangeText={(apiKey) => setS({ ...s, apiKey })}
        placeholder="gsk_..."
        placeholderTextColor={c.sub}
        secureTextEntry={!showKey}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Clé Groq"
      />
      <Pressable onPress={() => setShowKey(!showKey)} style={styles.link} accessibilityRole="button">
        <Text style={{ color: c.accent, fontSize: type.body, fontWeight: '600' }}>
          {showKey ? 'Masquer la clé' : 'Afficher la clé'}
        </Text>
      </Pressable>
      <Text style={[styles.help, { color: c.sub }]}>
        Créez-la gratuitement sur console.groq.com (API Keys). Elle est gardée dans le trousseau sécurisé de l'iPhone.
      </Text>

      <Text style={[styles.label, { color: c.text }]}>Langue de la transcription</Text>
      <View style={[styles.segment, { backgroundColor: c.border }]} accessibilityRole="radiogroup">
        {([['fr', 'Français'], ['auto', 'Détection auto']] as [Language, string][]).map(([value, label]) => {
          const selected = s.language === value;
          return (
            <Pressable
              key={value}
              onPress={() => setS({ ...s, language: value })}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={[styles.segmentItem, selected && { backgroundColor: c.card }]}
            >
              <Text style={{ color: c.text, fontSize: type.body, fontWeight: selected ? '700' : '500' }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.switchRow, { borderTopColor: c.border, borderBottomColor: c.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: c.text }]}>Rappel de consentement</Text>
          <Text style={[styles.help, { color: c.sub, marginTop: 2 }]}>
            Demande de prévenir les participants avant d'enregistrer.
          </Text>
        </View>
        <Switch
          value={s.consentReminder}
          onValueChange={(consentReminder) => setS({ ...s, consentReminder })}
          accessibilityLabel="Rappel de consentement"
        />
      </View>

      <Text style={[styles.label, { color: c.text }]}>Webhook (facultatif)</Text>
      <TextInput
        style={input}
        value={s.webhookUrl}
        onChangeText={(webhookUrl) => setS({ ...s, webhookUrl })}
        placeholder="https://..."
        placeholderTextColor={c.sub}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        accessibilityLabel="Adresse du webhook"
      />
      <Text style={[styles.help, { color: c.sub }]}>
        À la fin de chaque synthèse, le JSON (titre, résumé, points clés, décisions, tâches) est envoyé à cette adresse.
      </Text>

      <View style={{ marginTop: space.xl }}>
        <Button label="Enregistrer les réglages" variant="primary" onPress={() => void save()} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.m, paddingBottom: space.xl * 2 },
  label: { fontSize: type.body, fontWeight: '700', marginTop: space.l, marginBottom: space.s },
  input: { minHeight: TOUCH, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, fontSize: type.body },
  link: { minHeight: 44, justifyContent: 'center' },
  help: { fontSize: type.small + 1, lineHeight: 20, marginTop: space.xs },
  segment: { flexDirection: 'row', borderRadius: 12, padding: 3 },
  segmentItem: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    marginTop: space.l,
    minHeight: TOUCH,
    paddingVertical: space.s,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowTitle: { fontSize: type.body, fontWeight: '600' },
});
