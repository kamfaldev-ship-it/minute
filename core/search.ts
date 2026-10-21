// Recherche dans les réunions : titre, synthèse et transcription (sans tenir compte des accents ni des majuscules).

import type { Meeting } from './types';

/** "Éléphant" -> "elephant" */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export interface SearchHit {
  meeting: Meeting;
  /** Extrait autour du premier passage trouvé (hors titre), ou null si seul le titre correspond. */
  snippet: string | null;
}

/** Texte de la synthèse mis à plat, pour la recherche. */
function summaryText(m: Meeting): string {
  const s = m.summary;
  if (!s) return '';
  return [s.titre, s.resume, ...s.points_cles, ...s.decisions, ...s.taches.map((t) => t.action)].join('\n');
}

/**
 * Extrait d'environ `radius` caractères de chaque côté de `query` dans `text`.
 * normalize() garde la même longueur que le texte d'origine pour les caractères courants,
 * on peut donc réutiliser l'index trouvé.
 */
export function makeSnippet(text: string, query: string, radius = 50): string | null {
  const index = normalize(text).indexOf(normalize(query));
  if (index < 0) return null;
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + query.length + radius);
  const piece = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${piece}${end < text.length ? '…' : ''}`;
}

/** Réunions contenant tous les mots de la recherche, titre d'abord, puis synthèse, puis transcription. */
export function searchMeetings(meetings: Meeting[], query: string): SearchHit[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return meetings.map((meeting) => ({ meeting, snippet: null }));

  const hits: SearchHit[] = [];
  for (const meeting of meetings) {
    const title = normalize(meeting.title);
    const summary = normalize(summaryText(meeting));
    const transcript = normalize(meeting.transcript ?? '');
    const all = `${title}\n${summary}\n${transcript}`;
    if (!words.every((w) => all.includes(w))) continue;

    // Extrait : le premier mot trouvé dans la synthèse, sinon dans la transcription.
    let snippet: string | null = null;
    for (const source of [summaryText(meeting), meeting.transcript ?? '']) {
      for (const w of words) {
        snippet = makeSnippet(source, w);
        if (snippet) break;
      }
      if (snippet) break;
    }
    hits.push({ meeting, snippet });
  }
  return hits;
}
