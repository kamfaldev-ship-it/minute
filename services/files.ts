// Petits utilitaires pour les fichiers audio (dossier de l'appli, iOS : Documents/ExpoAudio).

import { Directory, File, Paths } from 'expo-file-system';
import { MAX_FILE_MB } from '../core/config';

/** Dossier où expo-audio écrit les enregistrements et où on copie les imports. */
export function audioDir(): Directory {
  const dir = new Directory(Paths.document, 'ExpoAudio');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export function fileExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

export function fileSizeBytes(uri: string): number {
  try {
    return new File(uri).size ?? 0;
  } catch {
    return 0;
  }
}

export function fileSizeMb(uri: string): number {
  return fileSizeBytes(uri) / (1024 * 1024);
}

export function isTooBig(uri: string): boolean {
  return fileSizeMb(uri) > MAX_FILE_MB;
}

export function deleteFile(uri: string): void {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // déjà supprimé : rien à faire
  }
}

export function extensionOf(nameOrUri: string): string {
  const clean = nameOrUri.split('?')[0];
  const dot = clean.lastIndexOf('.');
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : '';
}

export function fileNameOf(uri: string): string {
  const clean = decodeURIComponent(uri.split('?')[0]);
  return clean.slice(clean.lastIndexOf('/') + 1);
}

/** Type MIME envoyé à Groq selon l'extension. */
export function mimeFor(ext: string): string {
  switch (ext) {
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'mp4':
      return 'audio/mp4';
    case 'm4a':
    default:
      return 'audio/m4a';
  }
}

/** Formats acceptés à l'import et au partage. */
export const ACCEPTED_EXTENSIONS = ['m4a', 'mp3', 'wav', 'mp4'];
