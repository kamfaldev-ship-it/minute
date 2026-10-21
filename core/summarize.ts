// Synthèse d'une transcription, courte ou longue.
//
//   transcription <= CHUNK_TOKENS  ->  1 appel (synthèse directe)
//   transcription plus longue      ->  1 appel par morceau (notes), puis 1 appel final
//
// Entre deux appels on attend un peu pour rester sous la limite gratuite
// de Groq (≈ 12 000 tokens / minute).

import { CHUNK_TOKENS, TOKENS_PER_MINUTE } from './config';
import { estimateTokens, splitText } from './chunking';
import { GroqError, type ChatMessage } from './groq';
import {
  SYSTEM_CHUNK,
  SYSTEM_SUMMARY,
  userChunkPrompt,
  userFinalFromNotesPrompt,
  userMergeNotesPrompt,
  userSummaryPrompt,
} from './prompts';
import { parseStamp } from './timestamps';
import type { FilConducteur, Section, Summary, Task } from './types';

/** Fonction d'appel au LLM, fournie par l'appelant (voir groq.ts -> chat). */
export type ChatFn = (messages: ChatMessage[], json: boolean) => Promise<string>;

export interface SummarizeDeps {
  chat: ChatFn;
  /** Attente entre deux appels (remplaçable dans les tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Mémoire des notes déjà obtenues : évite de tout refaire après un échec. */
  notesCache?: Map<number, string>;
  /** Pour afficher la progression ("morceau 2/5"). */
  onProgress?: (done: number, total: number) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function summarizeTranscript(
  transcript: string,
  deps: SummarizeDeps
): Promise<Summary> {
  const sleep = deps.sleep ?? defaultSleep;
  const text = transcript.trim();
  if (!text) {
    throw new GroqError('bad_response', "La transcription est vide : rien à résumer (audio silencieux ?).");
  }

  // Cas simple : la transcription tient en un seul appel.
  if (estimateTokens(text) <= CHUNK_TOKENS) {
    const raw = await deps.chat(
      [
        { role: 'system', content: SYSTEM_SUMMARY },
        { role: 'user', content: userSummaryPrompt(text) },
      ],
      true
    );
    return parseSummary(raw);
  }

  // Cas long : notes par morceau, puis synthèse finale.
  const chunks = splitText(text, CHUNK_TOKENS);
  const cache = deps.notesCache ?? new Map<number, string>();
  const notes: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    deps.onProgress?.(i, chunks.length + 1);
    let note = cache.get(i);
    if (note === undefined) {
      note = await deps.chat(
        [
          { role: 'system', content: SYSTEM_CHUNK },
          { role: 'user', content: userChunkPrompt(chunks[i], i, chunks.length) },
        ],
        false
      );
      cache.set(i, note);
      // Tokens consommés (entrée + sortie estimée) -> temps à laisser passer.
      const used = estimateTokens(chunks[i]) + estimateTokens(note) + 400;
      await sleep(Math.ceil((used / TOKENS_PER_MINUTE) * 60_000));
    }
    notes.push(note);
  }

  // Si les notes sont trop longues pour tenir dans la limite d'une requête, on les fusionne par paquets.
  let level = notes;
  let round = 0;
  while (estimateTokens(level.join('\n\n')) > CHUNK_TOKENS && level.length > 1 && round < 4) {
    const merged: string[] = [];
    let batch: string[] = [];
    const flush = async () => {
      if (batch.length === 0) return;
      const note = batch.length === 1
        ? batch[0]
        : await deps.chat(
            [
              { role: 'system', content: SYSTEM_CHUNK },
              { role: 'user', content: userMergeNotesPrompt(batch) },
            ],
            false
          );
      if (batch.length > 1) {
        const used = estimateTokens(batch.join('')) + estimateTokens(note) + 400;
        await sleep(Math.ceil((used / TOKENS_PER_MINUTE) * 60_000));
      }
      merged.push(note);
      batch = [];
    };
    for (const note of level) {
      if (batch.length > 0 && estimateTokens(batch.join('\n\n') + note) > CHUNK_TOKENS) await flush();
      batch.push(note);
    }
    await flush();
    if (merged.length >= level.length) break; // rien à gagner : on évite une boucle infinie
    level = merged;
    round += 1;
  }

  deps.onProgress?.(chunks.length, chunks.length + 1);
  const raw = await deps.chat(
    [
      { role: 'system', content: SYSTEM_SUMMARY },
      { role: 'user', content: userFinalFromNotesPrompt(level) },
    ],
    true
  );
  return parseSummary(raw);
}

// ------------------------------------------------------------
// Lecture tolérante du JSON renvoyé par le LLM
// ------------------------------------------------------------

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim())
    .filter(Boolean);
}

function toTask(value: unknown): Task | null {
  if (typeof value === 'string') return value.trim() ? { action: value.trim() } : null;
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const action = typeof v.action === 'string' ? v.action.trim() : '';
  if (!action) return null;
  const task: Task = { action };
  if (typeof v.responsable === 'string' && v.responsable.trim()) task.responsable = v.responsable.trim();
  if (typeof v.echeance === 'string' && v.echeance.trim()) task.echeance = v.echeance.trim();
  const minute = parseStamp(v.minute);
  if (minute !== undefined) task.minute = minute;
  return task;
}

function toSection(value: unknown): Section | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const titre = typeof v.titre === 'string' ? v.titre.trim() : '';
  const details = toStringList(v.details);
  if (!titre && details.length === 0) return null;
  const role = v.role === 'principal' || v.role === 'secondaire' ? v.role : undefined;
  const rubrique = typeof v.rubrique === 'string' && v.rubrique.trim() ? v.rubrique.trim() : 'Sujet';
  const section: Section = { ...(role ? { role } : {}), rubrique, titre: titre || rubrique, details };
  const minute = parseStamp(v.minute);
  if (minute !== undefined) section.minute = minute;
  return section;
}

function toFil(value: unknown): FilConducteur | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const titre = typeof v.titre === 'string' ? v.titre.trim() : '';
  if (!titre) return undefined;
  const description = typeof v.description === 'string' ? v.description.trim() : '';
  const minutes = (Array.isArray(v.minutes) ? v.minutes : [])
    .map(parseStamp)
    .filter((m): m is number => m !== undefined);
  return { titre, description, minutes };
}

/** Transforme la réponse brute du LLM en objet Summary propre. */
export function parseSummary(raw: string): Summary {
  let data: Record<string, unknown>;
  try {
    // Au cas où le modèle entoure le JSON de ```json ... ```
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    data = JSON.parse(cleaned);
  } catch {
    throw new GroqError('bad_response', "La synthèse reçue n'est pas un JSON valide. Réessayez.");
  }

  const resumeRaw = Array.isArray(data.resume) ? data.resume.join('\n') : String(data.resume ?? '');
  // Le résumé est limité à 5 lignes.
  const resume = resumeRaw.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 5).join('\n');

  return {
    titre: String(data.titre ?? '').trim() || 'Réunion sans titre',
    resume,
    points_cles: toStringList(data.points_cles),
    decisions: toStringList(data.decisions),
    taches: (Array.isArray(data.taches) ? data.taches : [])
      .map(toTask)
      .filter((t): t is Task => t !== null),
    fil_conducteur: toFil(data.fil_conducteur),
    sections: (Array.isArray(data.sections) ? data.sections : [])
      .map(toSection)
      .filter((x): x is Section => x !== null),
  };
}
