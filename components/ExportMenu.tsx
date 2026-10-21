// Menu « Exporter » : feuille native iOS avec le texte (Markdown) et l'audio d'origine.

import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { ActionSheetIOS, Alert, Share } from 'react-native';
import { meetingToMarkdown } from '../core/markdown';
import type { Meeting, Segment } from '../core/types';
import { exportSegment } from './AudioParts';

export function showExportMenu(meeting: Meeting, segments: Segment[]) {
  const markdown = meetingToMarkdown(meeting);
  const hasText = !!(meeting.summary || meeting.transcript);

  type Entry = { label: string; run: () => void | Promise<void> };
  const entries: Entry[] = [];

  if (hasText) {
    entries.push({
      label: 'Copier en Markdown',
      run: async () => {
        await Clipboard.setStringAsync(markdown);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Copié', 'Le compte rendu est copié en Markdown.');
      },
    });
    entries.push({
      label: 'Partager le texte',
      run: () => void Share.share({ message: markdown, title: meeting.title }),
    });
  }
  for (const segment of segments) {
    entries.push({
      label: segments.length > 1 ? `Exporter l'audio, partie ${segment.idx + 1}` : "Exporter l'audio",
      run: () => exportSegment(meeting.title, segment, segments.length),
    });
  }

  if (entries.length === 0) {
    Alert.alert('Rien à exporter', "La synthèse et l'audio ne sont pas encore disponibles.");
    return;
  }

  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: 'Exporter',
      options: [...entries.map((e) => e.label), 'Annuler'],
      cancelButtonIndex: entries.length,
    },
    (index) => {
      if (index < entries.length) void entries[index].run();
    }
  );
}
