// Identité visuelle de Minute : papier froid, encre bleu nuit, bleu stylo pour les actions.
// Le rouge n'apparaît que pour l'enregistrement et les actions destructives.
// Le mode clair / sombre suit automatiquement le réglage de l'iPhone.

import { Platform, useColorScheme } from 'react-native';

const light = {
  bg: '#F4F6F8', // papier
  card: '#FFFFFF', // surface
  text: '#14213D', // encre
  sub: '#5B6678', // texte secondaire (contraste 5,4:1 sur le papier)
  border: '#DDE2E9', // filets
  accent: '#2B3FE0', // bleu stylo
  onAccent: '#FFFFFF',
  record: '#C62832',
  onRecord: '#FFFFFF',
  ok: '#1B7F4F',
  danger: '#C62832',
};

const dark: typeof light = {
  bg: '#0E1116',
  card: '#171B22',
  text: '#E8ECF2',
  sub: '#98A3B5',
  border: '#2A303A',
  accent: '#8C9BFF',
  onAccent: '#0E1116',
  record: '#FF6B72',
  onRecord: '#0E1116',
  ok: '#4CC38A',
  danger: '#FF6B72',
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

/** Taille minimale d'une zone tactile confortable (en points). */
export const TOUCH = 56;

/** Échelle d'espacement (multiples de 4). */
export const space = { xs: 4, s: 8, m: 16, l: 24, xl: 32 };

/** Échelle typographique. */
export const type = { small: 13, label: 15, body: 17, title: 22, headline: 30, clock: 64 };

/** Titres en serif (côté « procès-verbal ») ; le reste utilise la police système. */
export const fonts = {
  display: Platform.OS === 'ios' ? 'Iowan Old Style' : 'serif',
};
