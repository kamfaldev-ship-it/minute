// Base de données SQLite : réunions, segments audio et file d'attente.
// Tout est stocké sur l'iPhone, rien ne part ailleurs (sauf vers Groq pour le traitement).

import * as SQLite from 'expo-sqlite';
import type { Job, JobKind, Meeting, MeetingStatus, Segment, SegmentStatus, Summary } from '../core/types';
import type { JobStore } from '../core/queue';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) dbPromise = SQLite.openDatabaseAsync('minigranola.db');
  return dbPromise;
}

/** Identifiant court et sans caractère spécial (sert aussi de nom de fichier audio). */
export function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ------------------------------------------------------------
// Notification de changement : l'interface se rafraîchit toute seule
// ------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeDb(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitChange() {
  listeners.forEach((l) => l());
}

// ------------------------------------------------------------
// Création des tables
// ------------------------------------------------------------

export async function initDb(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      duration_sec INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      error TEXT,
      transcript TEXT,
      summary TEXT,
      finalized INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS segments (
      id TEXT PRIMARY KEY NOT NULL,
      meeting_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      uri TEXT NOT NULL,
      duration_sec INTEGER NOT NULL DEFAULT 0,
      transcript TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      meeting_id TEXT NOT NULL,
      segment_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );
  `);
  // Colonne ajoutée après la première version : on l'ajoute aux bases déjà créées.
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(meetings)');
  if (!columns.some((c) => c.name === 'title_edited')) {
    await db.execAsync('ALTER TABLE meetings ADD COLUMN title_edited INTEGER NOT NULL DEFAULT 0');
  }
}

// ------------------------------------------------------------
// Réunions
// ------------------------------------------------------------

interface MeetingRow {
  id: string;
  title: string;
  created_at: number;
  duration_sec: number;
  status: MeetingStatus;
  error: string | null;
  transcript: string | null;
  summary: string | null;
  finalized: number;
  title_edited: number;
}

function toMeeting(r: MeetingRow): Meeting {
  let summary: Summary | null = null;
  if (r.summary) {
    try {
      summary = JSON.parse(r.summary);
    } catch {
      summary = null;
    }
  }
  return {
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    durationSec: r.duration_sec,
    status: r.status,
    error: r.error,
    transcript: r.transcript,
    summary,
    finalized: r.finalized === 1,
    titleEdited: r.title_edited === 1,
  };
}

export async function createMeeting(title: string, status: MeetingStatus = 'recording'): Promise<string> {
  const db = await getDb();
  const id = makeId();
  await db.runAsync(
    'INSERT INTO meetings (id, title, created_at, status, finalized) VALUES (?, ?, ?, ?, 0)',
    id,
    title,
    Date.now(),
    status
  );
  emitChange();
  return id;
}

export interface MeetingPatch {
  title?: string;
  durationSec?: number;
  status?: MeetingStatus;
  error?: string | null;
  transcript?: string | null;
  summary?: Summary | null;
  finalized?: boolean;
  titleEdited?: boolean;
}

export async function updateMeeting(id: string, patch: MeetingPatch): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  const add = (col: string, v: string | number | null) => {
    sets.push(`${col} = ?`);
    values.push(v);
  };
  if (patch.title !== undefined) add('title', patch.title);
  if (patch.durationSec !== undefined) add('duration_sec', Math.round(patch.durationSec));
  if (patch.status !== undefined) add('status', patch.status);
  if (patch.error !== undefined) add('error', patch.error);
  if (patch.transcript !== undefined) add('transcript', patch.transcript);
  if (patch.summary !== undefined) add('summary', patch.summary ? JSON.stringify(patch.summary) : null);
  if (patch.finalized !== undefined) add('finalized', patch.finalized ? 1 : 0);
  if (patch.titleEdited !== undefined) add('title_edited', patch.titleEdited ? 1 : 0);
  if (!sets.length) return;
  await db.runAsync(`UPDATE meetings SET ${sets.join(', ')} WHERE id = ?`, ...values, id);
  emitChange();
}

export async function getMeeting(id: string): Promise<Meeting | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<MeetingRow>('SELECT * FROM meetings WHERE id = ?', id);
  return row ? toMeeting(row) : null;
}

export async function listMeetings(): Promise<Meeting[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<MeetingRow>('SELECT * FROM meetings ORDER BY created_at DESC');
  return rows.map(toMeeting);
}

/** Supprime la réunion et ses lignes (les fichiers audio sont supprimés par l'appelant). */
export async function deleteMeetingRows(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM jobs WHERE meeting_id = ?', id);
  await db.runAsync('DELETE FROM segments WHERE meeting_id = ?', id);
  await db.runAsync('DELETE FROM meetings WHERE id = ?', id);
  emitChange();
}

// ------------------------------------------------------------
// Segments
// ------------------------------------------------------------

interface SegmentRow {
  id: string;
  meeting_id: string;
  idx: number;
  uri: string;
  duration_sec: number;
  transcript: string | null;
  status: SegmentStatus;
}

function toSegment(r: SegmentRow): Segment {
  return {
    id: r.id,
    meetingId: r.meeting_id,
    idx: r.idx,
    uri: r.uri,
    durationSec: r.duration_sec,
    transcript: r.transcript,
    status: r.status,
  };
}

export async function addSegment(meetingId: string, idx: number, uri: string, durationSec: number): Promise<string> {
  const db = await getDb();
  const id = makeId();
  await db.runAsync(
    'INSERT INTO segments (id, meeting_id, idx, uri, duration_sec, status) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    meetingId,
    idx,
    uri,
    Math.round(durationSec),
    'pending'
  );
  emitChange();
  return id;
}

export async function getSegment(id: string): Promise<Segment | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<SegmentRow>('SELECT * FROM segments WHERE id = ?', id);
  return row ? toSegment(row) : null;
}

export async function listSegments(meetingId: string): Promise<Segment[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SegmentRow>('SELECT * FROM segments WHERE meeting_id = ? ORDER BY idx', meetingId);
  return rows.map(toSegment);
}

export async function listAllSegments(): Promise<Segment[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SegmentRow>('SELECT * FROM segments');
  return rows.map(toSegment);
}

export async function updateSegment(
  id: string,
  patch: { transcript?: string | null; status?: SegmentStatus }
): Promise<void> {
  const db = await getDb();
  if (patch.transcript !== undefined) {
    await db.runAsync('UPDATE segments SET transcript = ? WHERE id = ?', patch.transcript, id);
  }
  if (patch.status !== undefined) {
    await db.runAsync('UPDATE segments SET status = ? WHERE id = ?', patch.status, id);
  }
  emitChange();
}

// ------------------------------------------------------------
// File d'attente (jobs)
// ------------------------------------------------------------

interface JobRow {
  id: number;
  kind: JobKind;
  meeting_id: string;
  segment_id: string | null;
  status: Job['status'];
  attempts: number;
  next_attempt_at: number;
  error: string | null;
}

function toJob(r: JobRow): Job {
  return {
    id: r.id,
    kind: r.kind,
    meetingId: r.meeting_id,
    segmentId: r.segment_id,
    status: r.status,
    attempts: r.attempts,
    nextAttemptAt: r.next_attempt_at,
    error: r.error,
  };
}

export async function enqueueJob(kind: JobKind, meetingId: string, segmentId: string | null = null): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT INTO jobs (kind, meeting_id, segment_id) VALUES (?, ?, ?)', kind, meetingId, segmentId);
  emitChange();
}

export async function hasJob(kind: JobKind, meetingId: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM jobs WHERE kind = ? AND meeting_id = ?',
    kind,
    meetingId
  );
  return (row?.n ?? 0) > 0;
}

/** Remet à zéro les jobs en échec d'une réunion (bouton "Réessayer"). */
export async function resetFailedJobs(meetingId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE jobs SET status = 'pending', attempts = 0, next_attempt_at = 0, error = NULL WHERE meeting_id = ? AND status = 'failed'",
    meetingId
  );
  await db.runAsync("UPDATE segments SET status = 'pending' WHERE meeting_id = ? AND status = 'error'", meetingId);
  emitChange();
}

// Un job "summarize" attend que tous les "transcribe" de sa réunion soient terminés ;
// un job "webhook" attend la fin de "summarize".
const NOT_BLOCKED = `
  (j.kind != 'summarize' OR NOT EXISTS (
     SELECT 1 FROM jobs t WHERE t.meeting_id = j.meeting_id AND t.kind = 'transcribe' AND t.status != 'done'))
  AND (j.kind != 'webhook' OR NOT EXISTS (
     SELECT 1 FROM jobs s WHERE s.meeting_id = j.meeting_id AND s.kind = 'summarize' AND s.status != 'done'))
`;

/** Implémentation SQLite de l'interface JobStore de core/queue.ts. */
export const sqliteJobStore: JobStore = {
  async resetRunning() {
    const db = await getDb();
    await db.runAsync("UPDATE jobs SET status = 'pending' WHERE status = 'running'");
  },

  async nextRunnable(now) {
    const db = await getDb();
    const row = await db.getFirstAsync<JobRow>(
      `SELECT j.* FROM jobs j WHERE j.status = 'pending' AND j.next_attempt_at <= ? AND ${NOT_BLOCKED} ORDER BY j.id LIMIT 1`,
      now
    );
    return row ? toJob(row) : null;
  },

  async nextWakeAt(now) {
    const db = await getDb();
    const row = await db.getFirstAsync<{ t: number | null }>(
      `SELECT MIN(j.next_attempt_at) AS t FROM jobs j WHERE j.status = 'pending' AND j.next_attempt_at > ? AND ${NOT_BLOCKED}`,
      now
    );
    return row?.t ?? null;
  },

  async markRunning(id) {
    const db = await getDb();
    await db.runAsync("UPDATE jobs SET status = 'running' WHERE id = ?", id);
  },

  async markDone(id) {
    const db = await getDb();
    await db.runAsync("UPDATE jobs SET status = 'done', error = NULL WHERE id = ?", id);
    emitChange();
  },

  async markRetry(id, attempts, nextAttemptAt, error) {
    const db = await getDb();
    await db.runAsync(
      "UPDATE jobs SET status = 'pending', attempts = ?, next_attempt_at = ?, error = ? WHERE id = ?",
      attempts,
      nextAttemptAt,
      error,
      id
    );
  },

  async markFailed(id, attempts, error) {
    const db = await getDb();
    await db.runAsync("UPDATE jobs SET status = 'failed', attempts = ?, error = ? WHERE id = ?", attempts, error, id);
  },
};
