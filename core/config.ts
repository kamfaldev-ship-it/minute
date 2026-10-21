// ============================================================
// Réglages "en dur" de MiniGranola. Modifiez ici, pas ailleurs.
// ============================================================

/** Modèle de transcription Groq (audio -> texte). */
export const TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo';

/** Modèle de synthèse Groq (texte -> JSON). llama-3.3-70b-versatile est refusé (404) sur ce compte ; autre choix : 'openai/gpt-oss-20b'. */
export const SUMMARY_MODEL = 'openai/gpt-oss-120b';

export const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
export const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Durée d'un segment d'enregistrement, en minutes.
 * 60 par défaut. Mettez 2 pour tester la rotation rapidement.
 */
export const ROTATION_MINUTES = 60;

/** Taille maximale d'un fichier audio accepté (Groq plafonne à 25 Mo). */
export const MAX_FILE_MB = 24;

/** Taille visée pour chaque morceau d'un gros fichier importé (marge sous MAX_FILE_MB). */
export const SPLIT_TARGET_MB = 20;

/** Au-delà, on refuse l'import (le découpage serait trop long pour le quota Whisper du jour). */
export const MAX_IMPORT_MB = 150;

/** Taille cible d'un morceau de transcription envoyé au LLM (en tokens estimés). */
export const CHUNK_TOKENS = 4000;

/** Limite Groq du modèle de synthèse (gpt-oss-120b) : 8 000 tokens par minute. */
export const TOKENS_PER_MINUTE = 8000;

/** Nombre d'essais pour chaque étape du pipeline. */
export const MAX_ATTEMPTS = 3;

/** Attente de base avant un nouvel essai (doublée à chaque échec). */
export const BASE_BACKOFF_MS = 2000;

/** Au-delà de cette attente demandée par Groq (retry-after), on abandonne (limite quotidienne). */
export const MAX_RETRY_AFTER_MS = 5 * 60 * 1000;

/**
 * Taille maximale (en tokens estimés) des extraits de réunions envoyés avec une question.
 * Une question coûte donc environ 5 000 à 6 000 tokens : avec 200 000 tokens par jour, ça fait
 * une trentaine de questions par jour (moins si vous faites aussi des synthèses).
 */
export const ASK_CONTEXT_TOKENS = 4500;
