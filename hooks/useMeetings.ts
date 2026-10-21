// Hooks qui relisent la base à chaque changement (l'écran se met à jour tout seul).

import { useEffect, useState } from 'react';
import type { Meeting } from '../core/types';
import { getMeeting, listMeetings, subscribeDb } from '../services/db';

export function useMeetings(): Meeting[] {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => void listMeetings().then((m) => alive && setMeetings(m));
    load();
    const unsubscribe = subscribeDb(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return meetings;
}

/** `undefined` = chargement, `null` = introuvable. */
export function useMeeting(id: string): Meeting | null | undefined {
  const [meeting, setMeeting] = useState<Meeting | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const load = () => void getMeeting(id).then((m) => alive && setMeeting(m));
    load();
    const unsubscribe = subscribeDb(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [id]);
  return meeting;
}
