// File d'attente : la LOGIQUE est ici (pur TypeScript), le STOCKAGE est fourni
// par l'appelant via l'interface `JobStore` (sur iPhone : SQLite, voir services/db.ts).
//
// Une réunion produit des jobs dans cet ordre :
//   transcribe (un par segment audio)  ->  summarize  ->  webhook (facultatif)
// Le store garantit qu'un job `summarize` n'est proposé qu'une fois tous les
// `transcribe` de sa réunion terminés.

import { errorMessage, retryDelayMs, shouldRetry } from './retry';
import { GroqError } from './groq';
import type { Job, JobKind } from './types';

export interface JobStore {
  /** Après un crash ou une fermeture brutale : les jobs "running" redeviennent "pending". */
  resetRunning(): Promise<void>;
  /** Prochain job prêt à tourner (pending, date atteinte, non bloqué), ou null. */
  nextRunnable(now: number): Promise<Job | null>;
  /** Plus petite date des jobs pending non bloqués mais pas encore prêts, ou null. */
  nextWakeAt(now: number): Promise<number | null>;
  markRunning(id: number): Promise<void>;
  markDone(id: number): Promise<void>;
  markRetry(id: number, attempts: number, nextAttemptAt: number, error: string): Promise<void>;
  markFailed(id: number, attempts: number, error: string): Promise<void>;
}

export type JobHandler = (job: Job) => Promise<void>;

export interface QueueDeps {
  store: JobStore;
  handlers: Record<JobKind, JobHandler>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** On n'attend pas plus longtemps que ça dans la boucle ; au-delà on rend la main. */
  maxWaitMs?: number;
  onJobDone?: (job: Job) => void | Promise<void>;
  /** `willRetry` = false signifie échec définitif (le bouton "Réessayer" prendra le relais). */
  onJobFailed?: (job: Job, error: unknown, willRetry: boolean) => void | Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Traite les jobs un par un jusqu'à ce qu'il n'y en ait plus de prêt.
 * Renvoie la date à laquelle il faudra relancer la file (ou null).
 */
export async function processQueue(deps: QueueDeps): Promise<{ nextWakeAt: number | null }> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const maxWait = deps.maxWaitMs ?? 90_000;

  await deps.store.resetRunning();

  for (;;) {
    const job = await deps.store.nextRunnable(now());

    if (!job) {
      const wake = await deps.store.nextWakeAt(now());
      if (wake === null) return { nextWakeAt: null };
      const wait = Math.max(0, wake - now());
      if (wait > maxWait) return { nextWakeAt: wake };
      await sleep(wait);
      continue;
    }

    const attempts = job.attempts + 1;
    await deps.store.markRunning(job.id);
    try {
      await deps.handlers[job.kind](job);
      await deps.store.markDone(job.id);
      await deps.onJobDone?.(job);
    } catch (error) {
      const message = errorMessage(error);
      if (shouldRetry(error, attempts)) {
        const retryAfter = error instanceof GroqError ? error.retryAfterMs : undefined;
        await deps.store.markRetry(job.id, attempts, now() + retryDelayMs(attempts, retryAfter), message);
        await deps.onJobFailed?.(job, error, true);
      } else {
        await deps.store.markFailed(job.id, attempts, message);
        await deps.onJobFailed?.(job, error, false);
      }
    }
  }
}
