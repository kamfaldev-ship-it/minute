// minigranola://record  ->  démarre l'enregistrement puis revient à l'accueil.
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Alert } from 'react-native';
import { getRecorderState, startRecording } from '../services/recorder';

export default function RecordRoute() {
  const router = useRouter();
  useEffect(() => {
    void (async () => {
      try {
        if (getRecorderState().phase === 'idle') await startRecording();
      } catch (e) {
        Alert.alert('Enregistrement impossible', e instanceof Error ? e.message : 'Erreur inconnue.');
      }
      router.replace('/');
    })();
  }, [router]);
  return null;
}
