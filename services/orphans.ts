// Récupération au lancement : si l'appli a été tuée pendant un enregistrement,
// les fichiers audio déjà écrits sont retrouvés et remis dans la file.
//
// Les fichiers s'appellent "<idReunion>_<numéro>.m4a" (voir recorder.ts), ce qui permet
// de savoir à quelle réunion ils appartiennent.

import { File } from 'expo-file-system';
import { addSegment, enqueueJob, getMeeting, hasJob, listAllSegments, listMeetings, listSegments, updateMeeting } from './db';
import { audioDir, deleteFile, fileNameOf } from './files';
import { finalizeMeeting, kickQueue } from './pipeline';

const MIN_BYTES = 1024;

export async function recoverOrphans(): Promise<number> {
  let recovered = 0;

  // 1. Fichiers audio qui ne sont pas dans la base.
  const known = new Set((await listAllSegments()).map((s) => fileNameOf(s.uri)));
  const touched = new Set<string>();

  for (const item of audioDir().list()) {
    if (!(item instanceof File)) continue;
    const name = item.name;
    if (known.has(name)) continue;

    if ((item.size ?? 0) < MIN_BYTES) {
      deleteFile(item.uri); // fichier vide laissé par une coupure
      continue;
    }
    const match = name.match(/^([a-z0-9]+)_(\d+)\.[a-z0-9]+$/i);
    if (!match) continue;
    const [, meetingId, idxText] = match;
    if (!(await getMeeting(meetingId))) continue; // réunion supprimée : on laisse le fichier

    const seconds = Math.round((item.size ?? 0) / 4000); // ≈ 32 kbps
    const segmentId = await addSegment(meetingId, Number(idxText), item.uri, seconds);
    await enqueueJob('transcribe', meetingId, segmentId);
    touched.add(meetingId);
    recovered += 1;
  }

  // 2. Réunions restées "en cours" alors que plus rien n'enregistre : on les termine.
  for (const meeting of await listMeetings()) {
    if (meeting.finalized) continue;
    const segments = await listSegments(meeting.id);
    if (segments.length === 0) {
      // Aucun audio récupérable : réunion vide, marquée en erreur pour que l'utilisateur la voie.
      await updateMeeting(meeting.id, { status: 'error', error: 'Enregistrement interrompu : aucun audio récupéré.', finalized: true });
      continue;
    }
    const total = segments.reduce((sum, s) => sum + s.durationSec, 0);
    await finalizeMeeting(meeting.id, total);
    touched.add(meeting.id);
  }

  // 3. Segments "pending" sans job (cas rare : coupure entre deux écritures).
  for (const meeting of await listMeetings()) {
    if (!meeting.finalized || meeting.status === 'done' || meeting.status === 'error') continue;
    if (!(await hasJob('summarize', meeting.id))) await enqueueJob('summarize', meeting.id);
  }

  void kickQueue();
  return recovered;
}
