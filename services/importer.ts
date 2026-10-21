// Import d'un fichier audio : bouton "Importer un audio" ou menu Partager d'iOS.
// Le fichier est copié dans le dossier de l'appli, puis le pipeline démarre seul.

import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { MAX_FILE_MB, MAX_IMPORT_MB } from '../core/config';
import { SplitError } from '../core/audioSplit';
import { createMeeting, deleteMeetingRows } from './db';
import { ACCEPTED_EXTENSIONS, audioDir, deleteFile, extensionOf, fileSizeMb } from './files';
import { finalizeMeeting, queueSegment } from './pipeline';
import { splitAudioFile } from './splitAudio';

/** Erreur dont le message est destiné à l'utilisateur. */
export class ImportError extends Error {}

/** Copie `sourceUri` dans l'appli et lance le traitement. Renvoie l'id de la réunion. */
export async function importAudioFile(sourceUri: string, displayName: string): Promise<string> {
  const ext = extensionOf(displayName) || extensionOf(sourceUri);
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    throw new ImportError(`Format ".${ext || '?'}" non pris en charge. Formats acceptés : ${ACCEPTED_EXTENSIONS.join(', ')}.`);
  }

  // Vérification de taille AVANT de copier.
  let sizeMb = 0;
  try {
    sizeMb = fileSizeMb(sourceUri);
  } catch {
    // taille inconnue : on vérifiera après la copie
  }
  if (sizeMb > MAX_IMPORT_MB) throw tooBig(sizeMb);

  const title = displayName.replace(/\.[^.]+$/, '') || 'Audio importé';
  const meetingId = await createMeeting(title, 'transcribing');
  // Un gros fichier est copié sous un autre nom : le premier morceau prendra le nom "_0".
  const mightSplit = sizeMb === 0 || sizeMb > MAX_FILE_MB;
  const target = new File(audioDir(), `${meetingId}_${mightSplit ? 'src' : '0'}.${ext}`);
  try {
    await new File(sourceUri).copy(target);
  } catch {
    await deleteMeetingRows(meetingId);
    throw new ImportError("Impossible de lire ce fichier. Réessayez depuis l'app Fichiers.");
  }

  const copiedMb = fileSizeMb(target.uri);
  if (copiedMb > MAX_IMPORT_MB) {
    deleteFile(target.uri);
    await deleteMeetingRows(meetingId);
    throw tooBig(copiedMb);
  }

  // Durée estimée d'après la taille (inconnue sans lecteur audio). Corrigée à l'affichage si besoin.
  if (copiedMb <= MAX_FILE_MB) {
    const estimatedSec = Math.round((copiedMb * 1024 * 1024) / (ext === 'wav' ? 32000 : 16000));
    await queueSegment(meetingId, 0, target.uri, estimatedSec);
    await finalizeMeeting(meetingId, estimatedSec);
    return meetingId;
  }

  // Fichier trop gros pour Groq : on le coupe en morceaux, transcrits un par un puis recollés.
  let pieces;
  try {
    pieces = splitAudioFile(target, ext, (i) => new File(audioDir(), `${meetingId}_${i}.${ext}`));
  } catch (e) {
    deleteFile(target.uri);
    await deleteMeetingRows(meetingId);
    throw e instanceof SplitError ? new ImportError(e.message) : new ImportError("Impossible de découper ce fichier. Essayez un fichier plus court.");
  }
  deleteFile(target.uri); // l'original n'est plus utile : les morceaux le remplacent
  let total = 0;
  for (let i = 0; i < pieces.length; i++) {
    await queueSegment(meetingId, i, pieces[i].uri, pieces[i].durationSec);
    total += pieces[i].durationSec;
  }
  await finalizeMeeting(meetingId, total);
  return meetingId;
}

function tooBig(sizeMb: number): ImportError {
  return new ImportError(
    `Ce fichier fait ${sizeMb.toFixed(0)} Mo, au-dessus de la limite de ${MAX_IMPORT_MB} Mo. ` +
      'Choisissez un fichier plus court.'
  );
}

/** Ouvre le sélecteur de fichiers. Renvoie l'id de la réunion créée, ou null si annulé. */
export async function pickAndImportAudio(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['audio/*', 'video/mp4'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  try {
    return await importAudioFile(asset.uri, asset.name);
  } finally {
    deleteFile(asset.uri); // copie temporaire du sélecteur
  }
}
