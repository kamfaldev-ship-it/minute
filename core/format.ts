// Petits formateurs d'affichage (durée, date).

/** 3725 -> "1:02:05", 75 -> "1:15" */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? h + ':' : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/** 3725 -> "1 h 02", 540 -> "9 min", 20 -> "20 s" */
export function formatDurationShort(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')}`;
  return `${m} min`;
}

/** Date lisible en français, ex. "lun. 19 oct. 2026, 10:45". */
export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Libellé de jour : "Aujourd'hui", "Hier" ou "lundi 12 octobre" (avec l'année si ce n'est pas l'année en cours). */
export function dayLabel(ms: number, now: number = Date.now()): string {
  const startOf = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const days = Math.round((startOf(now) - startOf(ms)) / 86_400_000);
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return 'Hier';
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  return new Date(ms).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** Regroupe des éléments (déjà triés du plus récent au plus ancien) par jour. */
export function groupByDay<T extends { createdAt: number }>(
  items: T[],
  now: number = Date.now()
): { title: string; data: T[] }[] {
  const sections: { title: string; data: T[] }[] = [];
  for (const item of items) {
    const title = dayLabel(item.createdAt, now);
    const last = sections[sections.length - 1];
    if (last && last.title === title) last.data.push(item);
    else sections.push({ title, data: [item] });
  }
  return sections;
}

/** Heure seule, ex. "11:23". */
export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** Nom de fichier lisible pour l'export audio : "Titre - partie 2.m4a" (sans caractères interdits). */
export function audioExportName(title: string, part: number, total: number, ext: string): string {
  const clean = title.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Réunion';
  return `${clean}${total > 1 ? ` - partie ${part}` : ''}.${ext}`;
}
