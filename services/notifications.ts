// Notifications locales : "synthèse prête" et "Enregistrement interrompu".

import * as Notifications from 'expo-notifications';

/** À appeler une fois au démarrage : affiche les notifications même appli ouverte. */
export function setupNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Demande l'autorisation (une seule fois, iOS mémorise la réponse). */
export async function ensureNotificationPermission(): Promise<void> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.status !== 'granted' && current.canAskAgain) {
      await Notifications.requestPermissionsAsync();
    }
  } catch {
    // Les notifications sont un confort : on ne bloque jamais l'appli pour ça.
  }
}

export async function notify(title: string, body: string): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: null, // tout de suite
    });
  } catch {
    // idem : ignoré si les notifications sont refusées
  }
}
