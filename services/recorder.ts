// Enregistreur : un seul enregistrement à la fois, découpé en segments de ROTATION_MINUTES.
//
//   Démarrer -> segment 0 -> (rotation) -> segment 1 -> ... -> Arrêter
//
// Chaque segment terminé est tout de suite enregistré en base et mis en file
// pour transcription (voir pipeline.ts). Si l'appli est tuée en plein
// enregistrement, les segments déjà faits sont conservés (voir orphans.ts).

import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  AudioModule,
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type AudioRecorder,
  type RecordingOptions,
} from 'expo-audio';
import { ROTATION_MINUTES } from '../core/config';
import { createMeeting, deleteMeetingRows } from './db';
import { audioDir, fileExists, fileSizeBytes } from './files';
import { notify } from './notifications';
import { finalizeMeeting, queueSegment } from './pipeline';

// ------------------------------------------------------------
// Format audio : AAC mono 16 kHz ~32 kbps (≈ 14 Mo par heure)
// ------------------------------------------------------------

// Réglages "à plat" attendus par le module natif iOS (c'est ce que fait useAudioRecorder en interne).
const AUDIO_OPTIONS = {
  extension: '.m4a',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
  isMeteringEnabled: true,
  directory: 'document',
  outputFormat: IOSOutputFormat.MPEG4AAC,
  audioQuality: AudioQuality.MEDIUM,
};

/** Un segment de moins de 1 Ko est vide : on l'ignore. */
const MIN_SEGMENT_BYTES = 1024;

/** Intervalle d'essai pour reprendre après une interruption (appel, Siri...). */
const RESUME_RETRY_MS = 3000;

// ------------------------------------------------------------
// État observable par l'interface
// ------------------------------------------------------------

export interface RecorderState {
  phase: 'idle' | 'starting' | 'recording' | 'stopping';
  meetingId: string | null;
  /** Secondes enregistrées depuis le début. */
  elapsedSec: number;
  /** Niveau sonore entre 0 et 1. */
  level: number;
  /** Vrai pendant une interruption (appel...) : en attente de reprise. */
  interrupted: boolean;
}

const IDLE: RecorderState = { phase: 'idle', meetingId: null, elapsedSec: 0, level: 0, interrupted: false };
let state: RecorderState = IDLE;
const listeners = new Set<() => void>();

function setState(patch: Partial<RecorderState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getRecorderState(): RecorderState {
  return state;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Hook React : se met à jour à chaque changement de l'enregistreur. */
export function useRecorderState(): RecorderState {
  return useSyncExternalStore(subscribe, getRecorderState, getRecorderState);
}

/** Erreur avec un message déjà prêt pour l'utilisateur. */
export class RecorderError extends Error {}

// ------------------------------------------------------------
// Variables internes
// ------------------------------------------------------------

let recorder: AudioRecorder | null = null;
let meetingId: string | null = null;
let segmentIdx = 0;
let finishedSec = 0; // durée des segments déjà terminés
let currentFileName = '';
let tickTimer: ReturnType<typeof setInterval> | null = null;
let rotationTimer: ReturnType<typeof setTimeout> | null = null;
let resumeTimer: ReturnType<typeof setInterval> | null = null;
let busy = false; // évite les opérations simultanées (rotation / arrêt / reprise)
let notRecordingTicks = 0;
let warnedInterruption = false;

function clearTimers() {
  if (tickTimer) clearInterval(tickTimer);
  if (rotationTimer) clearTimeout(rotationTimer);
  if (resumeTimer) clearInterval(resumeTimer);
  tickTimer = rotationTimer = resumeTimer = null;
}

// ------------------------------------------------------------
// Segments
// ------------------------------------------------------------

async function beginSegment(): Promise<void> {
  if (!meetingId) throw new RecorderError('Aucune réunion en cours.');
  currentFileName = `${meetingId}_${segmentIdx}`;
  // Le nom de fichier contient l'id de la réunion : ainsi on retrouve les fichiers orphelins.
  const options = { ...AUDIO_OPTIONS, fileName: currentFileName } as unknown as Partial<RecordingOptions>;
  const r = new AudioModule.AudioRecorder(options);
  try {
    await r.prepareToRecordAsync();
    r.record();
  } catch (e) {
    r.release?.();
    throw e;
  }
  recorder = r;
  notRecordingTicks = 0;

  if (rotationTimer) clearTimeout(rotationTimer);
  rotationTimer = setTimeout(() => void rotate(), ROTATION_MINUTES * 60 * 1000);
}

/** Arrête le segment en cours et le met en file. Ne lève jamais d'erreur. */
async function endSegment(): Promise<void> {
  const r = recorder;
  const id = meetingId;
  if (!r || !id) return;
  recorder = null;
  if (rotationTimer) clearTimeout(rotationTimer);
  rotationTimer = null;

  let seconds = 0;
  try {
    seconds = Math.round(r.getStatus().durationMillis / 1000);
  } catch {
    // recorder déjà invalide : on se rabat sur le fichier
  }
  try {
    await r.stop();
  } catch {
    // arrêt déjà fait par le système (interruption) : le fichier est quand même là
  }
  const uri = r.uri ?? `${audioDir().uri.replace(/\/$/, '')}/${currentFileName}.m4a`;
  r.release?.();

  if (fileExists(uri) && fileSizeBytes(uri) >= MIN_SEGMENT_BYTES) {
    // ~4 000 octets par seconde à 32 kbps : estimation si la durée est inconnue.
    if (!seconds) seconds = Math.round(fileSizeBytes(uri) / 4000);
    finishedSec += seconds;
    await queueSegment(id, segmentIdx, uri, seconds);
    segmentIdx += 1;
  }
}

/** Fin d'un segment programmée : on enchaîne aussitôt avec le suivant. */
async function rotate(): Promise<void> {
  if (busy || state.phase !== 'recording' || !meetingId) return;
  busy = true;
  try {
    await endSegment();
    try {
      await beginSegment();
    } catch {
      await abortRecording('Impossible de redémarrer l\'enregistrement.');
    }
  } finally {
    busy = false;
  }
}

/** Le redémarrage a échoué : on garde tout ce qui est enregistré et on lance le traitement. */
async function abortRecording(reason: string): Promise<void> {
  const id = meetingId;
  clearTimers();
  await notify('Enregistrement interrompu', `${reason} Ce qui a été enregistré est en cours de traitement.`);
  if (id) await finishMeeting(id);
  resetRecorder();
}

async function finishMeeting(id: string): Promise<void> {
  if (finishedSec === 0 && segmentIdx === 0) {
    // Rien d'enregistré : on retire la réunion vide.
    await deleteMeetingRows(id);
    return;
  }
  await finalizeMeeting(id, finishedSec);
}

function resetRecorder() {
  clearTimers();
  recorder = null;
  meetingId = null;
  segmentIdx = 0;
  finishedSec = 0;
  warnedInterruption = false;
  setState(IDLE);
}

// ------------------------------------------------------------
// Surveillance régulière : chrono, niveau sonore, interruptions
// ------------------------------------------------------------

function tick() {
  if (state.phase !== 'recording') return;

  if (!recorder) {
    setState({ elapsedSec: finishedSec, level: 0 });
    return;
  }

  let status;
  try {
    status = recorder.getStatus();
  } catch {
    return;
  }

  const db = status.metering ?? -160; // en décibels, de -160 (silence) à 0
  const level = Math.max(0, Math.min(1, (db + 60) / 60));
  setState({ elapsedSec: finishedSec + status.durationMillis / 1000, level });

  // Interruption (appel entrant, Siri...) : le système arrête l'enregistreur sans nous prévenir.
  if (!busy && (!status.isRecording || status.mediaServicesDidReset)) {
    notRecordingTicks += 1;
    if (notRecordingTicks >= 2) void handleInterruption();
  } else {
    notRecordingTicks = 0;
  }
}

async function handleInterruption(): Promise<void> {
  if (busy || state.phase !== 'recording') return;
  busy = true;
  try {
    await endSegment(); // sauvegarde ce qui a été enregistré avant l'interruption
    setState({ interrupted: true, level: 0 });
    if (!(await tryResume())) {
      startResumeLoop();
    }
  } finally {
    busy = false;
  }
}

/** Tente de reprendre l'enregistrement dans un nouveau segment. */
async function tryResume(): Promise<boolean> {
  try {
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: true });
    await beginSegment();
    setState({ interrupted: false });
    warnedInterruption = false;
    return true;
  } catch {
    if (!warnedInterruption) {
      warnedInterruption = true;
      await notify(
        'Enregistrement interrompu',
        "Un appel ou Siri a coupé l'enregistrement. Il reprendra dès que possible ; ouvrez MiniGranola si besoin."
      );
    }
    return false;
  }
}

function startResumeLoop() {
  if (resumeTimer) clearInterval(resumeTimer);
  resumeTimer = setInterval(async () => {
    if (busy || state.phase !== 'recording' || recorder) return;
    busy = true;
    try {
      if (await tryResume()) {
        if (resumeTimer) clearInterval(resumeTimer);
        resumeTimer = null;
      }
    } finally {
      busy = false;
    }
  }, RESUME_RETRY_MS);
}

// Quand l'appli revient au premier plan après une interruption, on réessaie tout de suite.
AppState.addEventListener('change', (next) => {
  if (next === 'active' && state.phase === 'recording' && state.interrupted && !busy && !recorder) {
    void (async () => {
      busy = true;
      try {
        if (await tryResume() && resumeTimer) {
          clearInterval(resumeTimer);
          resumeTimer = null;
        }
      } finally {
        busy = false;
      }
    })();
  }
});

// ------------------------------------------------------------
// Commandes publiques
// ------------------------------------------------------------

export async function startRecording(): Promise<string> {
  if (state.phase !== 'idle') throw new RecorderError('Un enregistrement est déjà en cours.');
  setState({ phase: 'starting' });
  try {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      throw new RecorderError(
        "Accès au micro refusé. Ouvrez Réglages > MiniGranola et activez le micro."
      );
    }
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      allowsBackgroundRecording: true,
      interruptionMode: 'doNotMix',
    });

    const title = `Réunion du ${new Date().toLocaleString('fr-FR', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    })}`;
    meetingId = await createMeeting(title);
    segmentIdx = 0;
    finishedSec = 0;
    await beginSegment();
  } catch (e) {
    if (meetingId) {
      await deleteMeetingRows(meetingId);
    }
    resetRecorder();
    if (e instanceof RecorderError) throw e;
    throw new RecorderError("Impossible de démarrer l'enregistrement. Vérifiez l'accès au micro.");
  }

  setState({ phase: 'recording', meetingId, elapsedSec: 0, level: 0, interrupted: false });
  tickTimer = setInterval(tick, 250);
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  return meetingId!;
}

/** Arrête l'enregistrement ; le pipeline (transcription + synthèse) démarre tout seul. */
export async function stopRecording(): Promise<string | null> {
  if (state.phase !== 'recording' || !meetingId) return null;
  // Attend qu'une rotation ou une reprise en cours soit finie.
  while (busy) await new Promise((r) => setTimeout(r, 100));

  const id = meetingId;
  setState({ phase: 'stopping' });
  clearTimers();
  await endSegment();
  await finishMeeting(id);
  try {
    await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false });
  } catch {
    // sans importance
  }
  resetRecorder();
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  return id;
}

/** Bascule pour le gros bouton. */
export async function toggleRecording(): Promise<void> {
  if (state.phase === 'idle') await startRecording();
  else if (state.phase === 'recording') await stopRecording();
}
