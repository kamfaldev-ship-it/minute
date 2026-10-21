// Réglages : la clé Groq (secret) et les préférences, tous dans le trousseau iOS (expo-secure-store).

import * as SecureStore from 'expo-secure-store';
import type { Language } from '../core/types';

const KEY_API = 'groq_api_key';
const KEY_LANG = 'language';
const KEY_CONSENT = 'consent_reminder';
const KEY_WEBHOOK = 'webhook_url';

export interface Settings {
  apiKey: string;
  language: Language;
  consentReminder: boolean;
  webhookUrl: string;
}

export async function loadSettings(): Promise<Settings> {
  const [apiKey, language, consent, webhookUrl] = await Promise.all([
    SecureStore.getItemAsync(KEY_API),
    SecureStore.getItemAsync(KEY_LANG),
    SecureStore.getItemAsync(KEY_CONSENT),
    SecureStore.getItemAsync(KEY_WEBHOOK),
  ]);
  return {
    apiKey: apiKey ?? '',
    language: language === 'auto' ? 'auto' : 'fr',
    consentReminder: consent !== 'off', // activé par défaut
    webhookUrl: webhookUrl ?? '',
  };
}

async function setOrDelete(key: string, value: string) {
  if (value) await SecureStore.setItemAsync(key, value);
  else await SecureStore.deleteItemAsync(key);
}

export async function saveSettings(s: Settings): Promise<void> {
  await Promise.all([
    setOrDelete(KEY_API, s.apiKey.trim()),
    SecureStore.setItemAsync(KEY_LANG, s.language),
    SecureStore.setItemAsync(KEY_CONSENT, s.consentReminder ? 'on' : 'off'),
    setOrDelete(KEY_WEBHOOK, s.webhookUrl.trim()),
  ]);
}
