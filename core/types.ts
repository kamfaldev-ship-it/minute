// Types partagés par toute l'application (TypeScript pur).

export type Language = 'fr' | 'auto';

/** Une tâche issue de la synthèse. `responsable` et `echeance` seulement si cités. */
export interface Task {
  action: string;
  responsable?: string;
  echeance?: string;
  /** Case à cocher dans l'écran de détail (non fournie par le LLM). */
  fait?: boolean;
  /** Moment de la réunion où la tâche est évoquée (secondes). */
  minute?: number;
}

/** Un sujet abordé, détaillé, avec le moment où il commence. */
export interface Section {
  /** Place du sujet : rattaché au fil conducteur, ou sujet secondaire. Absent des anciennes synthèses. */
  role?: 'principal' | 'secondaire';
  /** Nature du sujet : "Avancée", "Blocage", "Information", "Digression"... */
  rubrique: string;
  titre: string;
  /** Début du sujet dans la réunion (secondes). */
  minute?: number;
  details: string[];
}

/** L'idée centrale de la réunion et les moments où on y revient. */
export interface FilConducteur {
  titre: string;
  description: string;
  /** Moments où le fil conducteur est abordé (secondes). */
  minutes: number[];
}

/** Résultat de la synthèse (JSON demandé au LLM). */
export interface Summary {
  titre: string;
  resume: string;
  points_cles: string[];
  decisions: string[];
  taches: Task[];
  /** Synthèse détaillée par sujet (absente des anciennes réunions). */
  sections?: Section[];
  /** Idée principale de la réunion (absente des anciennes synthèses). */
  fil_conducteur?: FilConducteur;
}

/** Étape du pipeline pour une réunion. */
export type MeetingStatus =
  | 'recording' // enregistrement en cours
  | 'transcribing' // segments en cours de transcription
  | 'summarizing' // synthèse en cours
  | 'done' // tout est terminé
  | 'error'; // une étape a échoué (voir `error`)

export interface Meeting {
  id: string;
  title: string;
  /** Date de début (ms depuis 1970). */
  createdAt: number;
  durationSec: number;
  status: MeetingStatus;
  /** Message d'erreur lisible si status === 'error'. */
  error: string | null;
  /** Transcription complète (segments recollés). */
  transcript: string | null;
  summary: Summary | null;
  /** Vrai quand l'enregistrement est terminé et que plus aucun segment n'arrivera. */
  finalized: boolean;
  /** Vrai si l'utilisateur a renommé la réunion : la synthèse ne doit plus changer le titre. */
  titleEdited: boolean;
}

export type SegmentStatus = 'pending' | 'done' | 'error';

/** Un fichier audio (un morceau de réunion, ou un fichier importé en entier). */
export interface Segment {
  id: string;
  meetingId: string;
  /** Ordre dans la réunion (0, 1, 2...). */
  idx: number;
  /** Chemin local du fichier audio. */
  uri: string;
  durationSec: number;
  transcript: string | null;
  status: SegmentStatus;
}

export type JobKind = 'transcribe' | 'summarize' | 'webhook';
export type JobStatus = 'pending' | 'running' | 'failed' | 'done';

/** Une ligne de la file d'attente persistante. */
export interface Job {
  id: number;
  kind: JobKind;
  meetingId: string;
  /** Renseigné pour les jobs de type 'transcribe'. */
  segmentId: string | null;
  status: JobStatus;
  attempts: number;
  /** Ne pas exécuter avant cette date (ms). */
  nextAttemptAt: number;
  error: string | null;
}
