// Racine de l'appli : prépare la base, récupère les fichiers orphelins,
// relance la file d'attente et écoute le menu "Partager" d'iOS.

import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { initDb } from '../services/db';
import { ImportError, importAudioFile } from '../services/importer';
import { ensureNotificationPermission, setupNotifications } from '../services/notifications';
import { recoverOrphans } from '../services/orphans';
import { kickQueue, watchAppState } from '../services/pipeline';
import { useColors } from '../theme/colors';

setupNotifications();

// Dans Expo Go, le module natif de partage n'existe pas : on le désactive pour pouvoir prévisualiser.
const IN_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** Importe automatiquement les fichiers audio reçus via "Partager". */
function ShareHandler() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const router = useRouter();

  useEffect(() => {
    if (!hasShareIntent) return;
    const files = shareIntent.files ?? [];
    resetShareIntent();
    if (files.length === 0) return;

    void (async () => {
      let lastId: string | null = null;
      for (const file of files) {
        try {
          const uri = file.path.startsWith('file://') ? file.path : `file://${file.path}`;
          lastId = await importAudioFile(uri, file.fileName);
        } catch (e) {
          const message = e instanceof ImportError ? e.message : "Impossible d'importer ce fichier.";
          Alert.alert('Import impossible', message);
        }
      }
      if (lastId) router.push({ pathname: '/meeting/[id]', params: { id: lastId } });
    })();
  }, [hasShareIntent, shareIntent, resetShareIntent, router]);

  return null;
}

export default function RootLayout() {
  const c = useColors();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      await initDb();
      await recoverOrphans(); // fichiers audio laissés par une appli tuée en plein enregistrement
      setReady(true);
      void ensureNotificationPermission();
      void kickQueue(); // reprend les envois interrompus
    })();
    return watchAppState();
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ShareIntentProvider options={{ disabled: IN_EXPO_GO }}>
      <StatusBar style="auto" />
      {IN_EXPO_GO ? null : <ShareHandler />}
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.bg },
          headerTintColor: c.accent,
          headerTitleStyle: { color: c.text },
          headerBackTitle: 'Retour',
          headerShadowVisible: false,
          contentStyle: { backgroundColor: c.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Minute' }} />
        <Stack.Screen name="meeting/[id]" options={{ title: 'Réunion' }} />
        <Stack.Screen name="settings" options={{ title: 'Réglages' }} />
        <Stack.Screen name="ask" options={{ title: 'Questions' }} />
        <Stack.Screen name="record" options={{ headerShown: false }} />
        <Stack.Screen name="stop" options={{ headerShown: false }} />
      </Stack>
    </ShareIntentProvider>
  );
}
