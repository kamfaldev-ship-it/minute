// Le pipeline automatique : transcription -> recollage -> synthèse -> webhook.
// Ce fichier branche la logique de core/ (file d'attente, Groq, synthèse) sur l'iPhone
// (SQLite, fichiers, notifications). Il n'y a rien à lancer à la main : on appelle
// seulement `kickQueue()` quand quelque chose de nouveau est prêt.

import { File } from 'expo-file-system';
import { AppState } from 'react-native';
import { chat, GroqError, transcribeAudio } from '../core/groq';
import { processQueue } from '../core/queue';
import { errorMessage } from '../core/retry';
import { summarizeTranscript } from '../core/summarize';
import { shiftTimestamps } from '../core/timestamps';
import type { Job } from '../core/types';
import {
  addSegment,
  enqueueJob,
  getMeeting,
  getSegment,
  hasJob,
  listSegments,
  resetFailedJobs,
  sqliteJobStore,
  updateMeeting,
  updateSegment,
} from './db';
import { extensionOf, fileExists, fileNameOf, isTooBig, mimeFor } from './files';
import { notify } from './notifications';
import { loadSettings } from './settings';

// Notes déjà obtenues pour chaque longue réunion (évite de refaire les appels après un échec).
const notesCaches = new Map<string, Map<number, string>>();

// ------------------------------------------------------------
// Les trois étapes
// ------------------------------------------------------------

async function runTranscribe(job: Job): Promise<void> {
  const segment = job.segmentId ? await getSegment(job.segmentId) : null;
  if (!segment) throw new Error('Segment audio introuvable.');
  if (!fileExists(segment.uri)) throw new Error("Le fichier audio n'existe plus sur l'iPhone.");
  if (isTooBig(segment.uri)) {
    throw new Error('Fichier audio trop volumineux (24 Mo maximum). Découpez-le ou choisissez un fichier plus court.');
  }

  const settings = await loadSettings();
  const name = fileNameOf(segment.uri);
  const text = await transcribeAudio(
    { apiKey: settings.apiKey },
    { uri: segment.uri, name, type: mimeFor(extensionOf(name)), blob: new File(segment.uri) as unknown as Blob },
    settings.language
  );

  await updateSegment(segment.id, { transcript: text, status: 'done' });
  await updateMeeting(job.meetingId, { status: 'transcribing', error: null });
}

async function runSummarize(job: Job): Promise<void> {
  const meeting = await getMeeting(job.meetingId);
  if (!meeting) throw new Error('Réunion introuvable.');

  // Recolle les textes dans l'ordre des segments.
  const segments = await listSegments(job.meetingId);
  // Les repères [mm:ss] de chaque morceau sont décalés de la durée des morceaux précédents.
  let offset = 0;
  const parts: string[] = [];
  for (const s of segments) {
    const text = (s.transcript ?? '').trim();
    if (text) parts.push(shiftTimestamps(text, offset));
    offset += s.durationSec;
  }
  const transcript = parts.join('\n\n');
  await updateMeeting(job.meetingId, { transcript, status: 'summarizing', error: null });

  if (!transcript) {
    throw new Error('Aucune parole détectée dans cet enregistrement. Rien à résumer.');
  }

  const settings = await loadSettings();
  if (!notesCaches.has(job.meetingId)) notesCaches.set(job.meetingId, new Map());

  const summary = await summarizeTranscript(transcript, {
    chat: (messages, json) => chat({ apiKey: settings.apiKey }, messages, json),
    notesCache: notesCaches.get(job.meetingId),
  });
  notesCaches.delete(job.meetingId);

  await updateMeeting(job.meetingId, {
    summary,
    ...(meeting.titleEdited ? {} : { title: summary.titre }),
    status: 'done',
    error: null,
  });
  await notify('Synthèse prête', summary.titre);

  // Webhook facultatif : un job séparé, pour qu'un échec n'abîme pas la synthèse.
  if (settings.webhookUrl) await enqueueJob('webhook', job.meetingId);
}

async function runWebhook(job: Job): Promise<void> {
  const settings = await loadSettings();
  const meeting = await getMeeting(job.meetingId);
  if (!settings.webhookUrl || !meeting?.summary) return;

  let res: Response;
  try {
    res = await fetch(settings.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...meeting.summary,
        date: new Date(meeting.createdAt).toISOString(),
        duree_sec: meeting.durationSec,
      }),
    });
  } catch {
    throw new GroqError('network', 'Webhook injoignable (réseau ou adresse incorrecte).');
  }
  if (!res.ok) {
    throw new GroqError(res.status >= 500 ? 'server' : 'bad_request', `Le webhook a répondu avec l'erreur ${res.status}.`);
  }
}

// ------------------------------------------------------------
// Boucle de traitement
// ------------------------------------------------------------

let running = false;
let rerun = false;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;

/** Lance (ou relance) le traitement de la file. Sans danger si déjà en cours. */
export async function kickQueue(): Promise<void> {
  if (running) {
    rerun = true; // on refera un tour dès que le tour actuel se termine
    return;
  }
  running = true;
  try {
    do {
      rerun = false;
      const { nextWakeAt } = await processQueue({
        store: sqliteJobStore,
        handlers: { transcribe: runTranscribe, summarize: runSummarize, webhook: runWebhook },
        onJobFailed: handleJobFailure,
      });
      scheduleWake(nextWakeAt);
    } while (rerun);
  } finally {
    running = false;
  }
}

/** Programme un réveil pour les nouveaux essais lointains (ex. limite Groq). */
function scheduleWake(at: number | null) {
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = null;
  if (at === null) return;
  wakeTimer = setTimeout(() => void kickQueue(), Math.max(1000, at - Date.now()));
}

async function handleJobFailure(job: Job, error: unknown, willRetry: boolean): Promise<void> {
  const message = errorMessage(error);

  if (job.kind === 'webhook') {
    if (!willRetry) await notify('Webhook en échec', message);
    return;
  }

  if (willRetry) {
    // Message visible pendant qu'on réessaie, sans changer l'étape.
    await updateMeeting(job.meetingId, { error: `${message} (nouvel essai automatique)` });
    return;
  }

  if (job.kind === 'transcribe' && job.segmentId) {
    await updateSegment(job.segmentId, { status: 'error' });
  }
  await updateMeeting(job.meetingId, { status: 'error', error: message });
  await notify('Traitement en échec', message);
}

/** Reprend la file quand l'appli revient au premier plan (ou démarre). */
export function watchAppState(): () => void {
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void kickQueue();
  });
  return () => sub.remove();
}

// ------------------------------------------------------------
// API utilisée par l'enregistreur, l'import et l'écran de détail
// ------------------------------------------------------------

/** Enregistre un fichier audio comme segment d'une réunion et le met en file. */
export async function queueSegment(meetingId: string, idx: number, uri: string, durationSec: number): Promise<void> {
  const segmentId = await addSegment(meetingId, idx, uri, durationSec);
  await enqueueJob('transcribe', meetingId, segmentId);
  void kickQueue();
}

/** La réunion est terminée : plus aucun segment n'arrivera, on peut lancer la synthèse. */
export async function finalizeMeeting(meetingId: string, durationSec: number): Promise<void> {
  await updateMeeting(meetingId, { durationSec, finalized: true, status: 'transcribing', error: null });
  if (!(await hasJob('summarize', meetingId))) await enqueueJob('summarize', meetingId);
  void kickQueue();
}

/** Bouton "Réessayer" : relance les étapes en échec. */
export async function retryMeeting(meetingId: string): Promise<void> {
  const meeting = await getMeeting(meetingId);
  if (!meeting) return;
  await resetFailedJobs(meetingId);
  if (!(await hasJob('summarize', meetingId))) await enqueueJob('summarize', meetingId);
  const segments = await listSegments(meetingId);
  const allTranscribed = segments.length > 0 && segments.every((s) => s.status === 'done');
  await updateMeeting(meetingId, {
    status: allTranscribed ? 'summarizing' : 'transcribing',
    error: null,
    finalized: true,
  });
  void kickQueue();
}
