// Export de l'audio original : copie le fichier avec un nom lisible, puis ouvre
// la feuille de partage iOS (Enregistrer dans Fichiers, AirDrop, Messages, Mail...).
// Aucune dépendance en plus : on utilise le `Share` de React Native.

import { File, Paths } from 'expo-file-system';
import { Share } from 'react-native';
import { audioExportName } from '../core/format';
import type { Segment } from '../core/types';
import { extensionOf, fileExists } from './files';

export class ExportError extends Error {}

/** Exporte un segment audio. `total` = nombre de parties de la réunion. */
export async function shareSegmentAudio(title: string, segment: Segment, total: number): Promise<void> {
  if (!fileExists(segment.uri)) {
    throw new ExportError("Ce fichier audio n'existe plus sur l'iPhone.");
  }

  const ext = extensionOf(segment.uri) || 'm4a';
  const target = new File(Paths.cache, audioExportName(title, segment.idx + 1, total, ext));
  try {
    if (target.exists) target.delete();
    await new File(segment.uri).copy(target);
    await Share.share({ url: target.uri });
  } catch (e) {
    if (e instanceof ExportError) throw e;
    throw new ExportError("Impossible d'exporter cet audio. Réessayez.");
  } finally {
    try {
      if (target.exists) target.delete(); // copie temporaire
    } catch {
      // sans importance
    }
  }
}
