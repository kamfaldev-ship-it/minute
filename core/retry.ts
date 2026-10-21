// Politique de nouvel essai : attente exponentielle + respect de retry-after.

import { BASE_BACKOFF_MS, MAX_ATTEMPTS } from './config';
import { GroqError } from './groq';

/**
 * Attente avant le prochain essai.
 * @param attemptsDone nombre d'essais déjà faits (1 après le premier échec)
 * @param retryAfterMs attente demandée par Groq, si elle existe
 * Exemple : 1er échec -> 2 s, 2e échec -> 4 s... mais jamais moins que retry-after.
 */
export function retryDelayMs(attemptsDone: number, retryAfterMs?: number): number {
  const backoff = BASE_BACKOFF_MS * 2 ** Math.max(0, attemptsDone - 1);
  return Math.max(backoff, retryAfterMs ?? 0);
}

/** Faut-il retenter après cette erreur ? */
export function shouldRetry(error: unknown, attemptsDone: number): boolean {
  if (attemptsDone >= MAX_ATTEMPTS) return false;
  // Les erreurs inconnues (bug, fichier absent...) ne se corrigent pas en réessayant.
  return error instanceof GroqError && error.retryable;
}

/** Message affichable pour n'importe quelle erreur. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Erreur inattendue.';
}
