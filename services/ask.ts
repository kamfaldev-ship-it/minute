// Questions à l'IA : relie core/ask.ts à la base de données et à la clé Groq.

import { askQuestion, type AskResult, type AskTurn } from '../core/ask';
import { chat } from '../core/groq';
import type { Meeting } from '../core/types';
import { getMeeting, listMeetings } from './db';
import { loadSettings } from './settings';

/** Interroge toutes les réunions, ou une seule si `meetingId` est fourni. */
export async function askAboutMeetings(question: string, history: AskTurn[], meetingId?: string): Promise<AskResult> {
  const settings = await loadSettings();
  const meetings: Meeting[] = meetingId
    ? [await getMeeting(meetingId)].filter((m): m is Meeting => m !== null)
    : await listMeetings();
  return askQuestion(meetings, question, history, (messages) =>
    chat({ apiKey: settings.apiKey }, messages, false)
  );
}
