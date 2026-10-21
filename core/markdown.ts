// Export d'une réunion au format Markdown (copier / partager).

import { formatStamp } from './timestamps';
import { formatDate, formatDurationShort } from './format';
import type { Meeting, Section } from './types';

/** Titre du groupe où ranger un sujet. */
export function sectionGroup(section: Section): string {
  if (section.role === 'principal') return 'Autour du fil conducteur';
  if (section.role === 'secondaire') return 'Sujets secondaires';
  return section.rubrique; // anciennes synthèses
}

export function meetingToMarkdown(meeting: Meeting): string {
  const s = meeting.summary;
  const lines: string[] = [];

  lines.push(`# ${meeting.title}`);
  lines.push('');
  lines.push(`*${formatDate(meeting.createdAt)} · ${formatDurationShort(meeting.durationSec)}*`);

  if (s) {
    if (s.resume) {
      lines.push('', '## Résumé', '', s.resume);
    }
    if (s.fil_conducteur) {
      const f = s.fil_conducteur;
      const when = f.minutes.length ? ` (${f.minutes.map(formatStamp).join(', ')})` : '';
      lines.push('', '## Fil conducteur', '', `**${f.titre}**${when}`);
      if (f.description) lines.push('', f.description);
    }
    // Sujets détaillés, groupés (fil conducteur / secondaires, ou rubrique pour les anciennes synthèses).
    const groups = [...new Set((s.sections ?? []).map(sectionGroup))];
    for (const group of groups) {
      lines.push('', `## ${group}`);
      for (const x of (s.sections ?? []).filter((y) => sectionGroup(y) === group)) {
        lines.push('', `### ${x.titre}${x.minute !== undefined ? ` (${formatStamp(x.minute)})` : ''}`, '');
        lines.push(...x.details.map((d) => `- ${d}`));
      }
    }
    if (s.points_cles.length && !(s.sections ?? []).length) {
      lines.push('', '## Points clés', '', ...s.points_cles.map((p) => `- ${p}`));
    }
    if (s.decisions.length) {
      lines.push('', '## Décisions', '', ...s.decisions.map((d) => `- ${d}`));
    }
    if (s.taches.length) {
      lines.push('', '## Tâches', '');
      for (const t of s.taches) {
        const details = [t.responsable && `responsable : ${t.responsable}`, t.echeance && `échéance : ${t.echeance}`]
          .filter(Boolean)
          .join(', ');
        lines.push(`- [${t.fait ? 'x' : ' '}] ${t.action}${t.minute !== undefined ? ` (${formatStamp(t.minute)})` : ''}${details ? ` (${details})` : ''}`);
      }
    }
  }

  if (meeting.transcript) {
    lines.push('', '## Transcription', '', meeting.transcript);
  }
  return lines.join('\n') + '\n';
}
