// Découpe d'un gros fichier audio importé en plusieurs fichiers sous la limite de Groq.
// Le plan est calculé dans core/audioSplit.ts ; ici on lit et on écrit les fichiers.

import { File, FileMode } from 'expo-file-system';
import { SPLIT_TARGET_MB } from '../core/config';
import { planSplit, type Piece } from '../core/audioSplit';

/** Lit un bloc à la fois pour ne jamais garder 20 Mo en mémoire d'un coup. */
const BLOCK_BYTES = 4 * 1024 * 1024;

export interface SplitResult {
  uri: string;
  durationSec: number;
}

/** Découpe `source` en fichiers `<prefix>_<n>.<ext>` dans `dir`. Ne supprime pas la source. */
export function splitAudioFile(source: File, ext: string, targetName: (index: number) => File): SplitResult[] {
  const size = source.size ?? 0;
  const input = source.open(FileMode.ReadOnly);
  try {
    const read = (offset: number, length: number) => {
      input.offset = offset;
      return input.readBytesSync(Math.max(0, Math.min(length, size - offset)));
    };
    const pieces = planSplit(ext, size, read, SPLIT_TARGET_MB * 1024 * 1024);

    const results: SplitResult[] = [];
    pieces.forEach((piece, index) => {
      const out = targetName(index);
      try {
        writePiece(piece, out, read);
      } catch (e) {
        for (const r of results) new File(r.uri).delete();
        if (out.exists) out.delete();
        throw e;
      }
      results.push({ uri: out.uri, durationSec: piece.durationSec });
    });
    return results;
  } finally {
    input.close();
  }
}

function writePiece(piece: Piece, out: File, read: (offset: number, length: number) => Uint8Array): void {
  if (out.exists) out.delete();
  out.create();
  const handle = out.open(FileMode.WriteOnly);
  try {
    for (const part of piece.parts) {
      if ('bytes' in part) {
        handle.writeBytesSync(part.bytes);
        continue;
      }
      for (let pos = part.from; pos < part.to; pos += BLOCK_BYTES) {
        handle.writeBytesSync(read(pos, Math.min(BLOCK_BYTES, part.to - pos)));
      }
    }
  } finally {
    handle.close();
  }
}
