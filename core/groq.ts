// Client Groq minimal. Une seule clé API, deux appels : transcription et chat.
// Ce fichier n'importe rien de React Native : `fetch` et `FormData` sont des
// API standard fournies par l'environnement (téléphone ou Node).

import {
  GROQ_CHAT_URL,
  GROQ_TRANSCRIPTION_URL,
  MAX_RETRY_AFTER_MS,
  SUMMARY_MODEL,
  TRANSCRIPTION_MODEL,
} from './config';
import { buildTimedTranscript } from './timestamps';
import type { Language } from './types';

export type GroqErrorCode =
  | 'no_key' // clé manquante
  | 'unauthorized' // clé refusée (401)
  | 'rate_limit' // limite Groq atteinte (429)
  | 'daily_limit' // 429 avec une attente très longue : quota du jour épuisé
  | 'network' // pas de connexion
  | 'too_large' // fichier trop gros (413)
  | 'server' // erreur côté Groq (5xx)
  | 'bad_request' // requête refusée (400...)
  | 'bad_response'; // réponse illisible

/** Erreur avec un message en français, affichable tel quel à l'utilisateur. */
export class GroqError extends Error {
  code: GroqErrorCode;
  /** Attente demandée par Groq (header retry-after), en ms. */
  retryAfterMs?: number;

  constructor(code: GroqErrorCode, message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'GroqError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }

  /** Vrai si un nouvel essai a une chance de réussir. */
  get retryable(): boolean {
    return (
      this.code === 'rate_limit' ||
      this.code === 'network' ||
      this.code === 'server'
    );
  }
}

/** Fichier audio à envoyer. Format attendu par React Native pour FormData. */
export interface FilePart {
  uri: string;
  name: string;
  type: string;
  /**
   * Fichier déjà ouvert comme Blob (ex. `new File(uri)` d'expo-file-system).
   * Le fetch des Expo récents refuse l'objet { uri, name, type } ("Unsupported
   * FormDataPart implementation") : avec un Blob, ça fonctionne partout.
   */
  blob?: Blob;
}

export interface GroqOptions {
  apiKey: string | null;
  /** Remplaçable pour les tests. */
  fetchFn?: typeof fetch;
}

function requireKey(key: string | null): string {
  if (!key || !key.trim()) {
    throw new GroqError(
      'no_key',
      'Clé Groq manquante. Ouvrez les Réglages et collez votre clé.'
    );
  }
  return key.trim();
}

/** Lit le header retry-after (en secondes, parfois décimal) et le convertit en ms. */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = parseFloat(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  return undefined;
}

/** Transforme une réponse HTTP en erreur claire. */
async function errorFromResponse(res: Response): Promise<GroqError> {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message ?? '';
  } catch {
    // corps non JSON : on ignore
  }

  if (res.status === 401 || res.status === 403) {
    return new GroqError(
      'unauthorized',
      'Clé Groq refusée. Vérifiez-la dans les Réglages (elle commence par "gsk_").'
    );
  }
  if (res.status === 429) {
    const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
    if (retryAfterMs !== undefined && retryAfterMs > MAX_RETRY_AFTER_MS) {
      return new GroqError(
        'daily_limit',
        'Limite quotidienne Groq atteinte. Réessayez plus tard (bouton "Réessayer").'
      );
    }
    return new GroqError(
      'rate_limit',
      'Limite Groq atteinte (trop de requêtes). Nouvel essai automatique dans un instant.',
      retryAfterMs
    );
  }
  if (res.status === 413) {
    return new GroqError('too_large', 'Fichier audio trop volumineux pour Groq (25 Mo maximum).');
  }
  if (res.status >= 500) {
    return new GroqError('server', `Groq rencontre un problème (erreur ${res.status}). Nouvel essai bientôt.`);
  }
  return new GroqError('bad_request', `Requête refusée par Groq (${res.status}). ${detail}`.trim());
}

function networkError(cause?: unknown): GroqError {
  // Le détail technique aide à distinguer un vrai souci réseau d'un fichier illisible.
  const detail = cause instanceof Error && cause.message ? ` (détail : ${cause.message})` : '';
  console.warn('[groq] échec de la requête', cause);
  return new GroqError(
    'network',
    `Impossible de joindre Groq. Vérifiez la connexion ; le traitement reprendra dès que possible.${detail}`
  );
}

/** Audio -> texte. `language` = 'fr' ou 'auto' (détection automatique). */
export async function transcribeAudio(
  opts: GroqOptions,
  file: FilePart,
  language: Language
): Promise<string> {
  const key = requireKey(opts.apiKey);
  const doFetch = opts.fetchFn ?? fetch;

  const form = new FormData();
  // React Native accepte { uri, name, type } à la place d'un Blob.
  // (Sur un Mac / Node, on passerait un vrai Blob ici.)
  if (file.blob) {
    form.append('file', file.blob, file.name);
  } else {
    form.append('file', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
  }
  form.append('model', TRANSCRIPTION_MODEL);
  form.append('response_format', 'verbose_json'); // donne aussi le début de chaque phrase
  form.append('temperature', '0');
  if (language !== 'auto') form.append('language', language);

  let res: Response;
  try {
    // Pas de Content-Type manuel : fetch ajoute lui-même la "boundary" du FormData.
    res = await doFetch(GROQ_TRANSCRIPTION_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
  } catch (e) {
    throw networkError(e);
  }
  if (!res.ok) throw await errorFromResponse(res);

  try {
    const data = await res.json();
    // Avec les phrases horodatées on fabrique des lignes "[12:03] ..." ; sinon, texte brut.
    if (Array.isArray(data.segments) && data.segments.length > 0) {
      const timed = buildTimedTranscript(
        data.segments.map((seg: { start?: number; text?: string }) => ({
          start: Number(seg.start ?? 0),
          text: String(seg.text ?? ''),
        }))
      );
      if (timed) return timed;
    }
    return String(data.text ?? '').trim();
  } catch {
    throw new GroqError('bad_response', 'Réponse de transcription illisible.');
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Appel au LLM. `json: true` force une réponse JSON (response_format json_object). */
export async function chat(
  opts: GroqOptions,
  messages: ChatMessage[],
  json: boolean
): Promise<string> {
  const key = requireKey(opts.apiKey);
  const doFetch = opts.fetchFn ?? fetch;

  const body: Record<string, unknown> = {
    model: SUMMARY_MODEL,
    messages,
    temperature: 0.2,
  };
  if (json) body.response_format = { type: 'json_object' };

  let res: Response;
  try {
    res = await doFetch(GROQ_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw networkError(e);
  }
  if (!res.ok) throw await errorFromResponse(res);

  try {
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('vide');
    return content;
  } catch {
    throw new GroqError('bad_response', 'Réponse du modèle illisible.');
  }
}
