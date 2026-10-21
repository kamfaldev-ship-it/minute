// minigranola://stop  ->  arrête l'enregistrement (le traitement démarre seul) puis revient à l'accueil.
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { stopRecording } from '../services/recorder';

export default function StopRoute() {
  const router = useRouter();
  useEffect(() => {
    void (async () => {
      await stopRecording();
      router.replace('/');
    })();
  }, [router]);
  return null;
}
