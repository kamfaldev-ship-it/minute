// Repères de temps dans la transcription : "[12:03] texte...".
// Les minutes sont celles de la réunion entière (les morceaux d'enregistrement sont recollés).

/** 754 -> "12:34" ; 4325 -> "1:12:05". */
export function formatStamp(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
}

/** "12:35", "[1:21:05]" ou "(12:35)" -> secondes. Renvoie undefined si ce n'est pas un repère. */
export function parseStamp(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
  if (typeof value !== 'string') return undefined;
  const m = value.match(/(?:(\d{1,2}):)?(\d{1,3}):(\d{2})/);
  if (!m) return undefined;
  const [, h, min, sec] = m;
  if (Number(sec) > 59) return undefined;
  return Number(h ?? 0) * 3600 + Number(min) * 60 + Number(sec);
}

export interface TimedSegment {
  start: number;
  text: string;
}

/** Regroupe les phrases de Whisper en lignes d'environ `gapSec` secondes, chacune précédée de son repère. */
export function buildTimedTranscript(segments: TimedSegment[], gapSec = 30): string {
  const lines: string[] = [];
  let lineStart = -Infinity;
  for (const seg of segments) {
    const text = seg.text.trim();
    if (!text) continue;
    if (lines.length === 0 || seg.start - lineStart >= gapSec) {
      lines.push(`[${formatStamp(seg.start)}] ${text}`);
      lineStart = seg.start;
    } else {
      lines[lines.length - 1] += ` ${text}`;
    }
  }
  return lines.join('\n');
}

const MARKER = /\[((?:\d{1,2}:)?\d{1,3}:\d{2})\]/g;

/** Décale tous les repères d'un texte (pour recoller les morceaux d'une longue réunion). */
export function shiftTimestamps(text: string, offsetSec: number): string {
  if (!offsetSec) return text;
  return text.replace(MARKER, (_all, stamp: string) => `[${formatStamp((parseStamp(stamp) ?? 0) + offsetSec)}]`);
}

export interface TranscriptLine {
  /** Repère de début de la ligne, en secondes (absent si la ligne n'en a pas). */
  sec?: number;
  text: string;
}

/** Découpe une transcription en lignes, avec leur repère. */
export function parseTranscriptLines(transcript: string): TranscriptLine[] {
  return transcript
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^\[((?:\d{1,2}:)?\d{1,3}:\d{2})\]\s*/);
      return m ? { sec: parseStamp(m[1]), text: line.slice(m[0].length) } : { text: line };
    });
}

/** Indice de la ligne à montrer pour la minute `sec` : le dernier repère qui ne la dépasse pas. */
export function lineIndexAt(lines: TranscriptLine[], sec: number): number {
  let found = 0;
  lines.forEach((l, i) => {
    if (l.sec !== undefined && l.sec <= sec) found = i;
  });
  return found;
}
