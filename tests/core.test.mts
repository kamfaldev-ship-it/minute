// Tests simples du dossier core/. Lancer avec :  npx tsx tests/core.test.ts
import assert from 'node:assert/strict';
import { estimateTokens, splitText } from '../core/chunking';
import { GroqError, chat, parseRetryAfter, transcribeAudio } from '../core/groq';
import { processQueue, type JobStore } from '../core/queue';
import { retryDelayMs } from '../core/retry';
import { parseSummary, summarizeTranscript } from '../core/summarize';
import { audioExportName, dayLabel, formatClock, formatDurationShort, groupByDay } from '../core/format';
import type { Job, Meeting } from '../core/types';
import { askQuestion, buildContext, keywords } from '../core/ask';
import { buildMp4Head, planSplit, type Part, type Sample } from '../core/audioSplit';
import { buildTimedTranscript, formatStamp, lineIndexAt, parseStamp, parseTranscriptLines, shiftTimestamps } from '../core/timestamps';
import { makeSnippet, normalize, searchMeetings } from '../core/search';

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log('ok  -', name);
}

await test('splitText coupe sans dépasser la taille', () => {
  const text = Array.from({ length: 400 }, (_, i) => `Phrase numéro ${i} de la réunion.`).join(' ');
  const chunks = splitText(text, 1000);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(estimateTokens(c) <= 1000, 'morceau trop grand');
  assert.equal(chunks.join(' ').replace(/\s+/g, ' ').length, text.length);
});

await test('splitText gère une phrase géante sans ponctuation', () => {
  const chunks = splitText('a'.repeat(10000), 1000);
  assert.ok(chunks.every((c) => estimateTokens(c) <= 1000));
});

await test('retryDelayMs : exponentiel et retry-after', () => {
  assert.equal(retryDelayMs(1), 2000);
  assert.equal(retryDelayMs(2), 4000);
  assert.equal(retryDelayMs(1, 9000), 9000);
  assert.equal(parseRetryAfter('2.5'), 2500);
});

await test('parseSummary tolère les ``` et nettoie les champs', () => {
  const s = parseSummary(
    '```json\n{"titre":"T","resume":"1\\n2\\n3\\n4\\n5\\n6","points_cles":["a"],"decisions":[],"taches":[{"action":"X","responsable":"Léa"},"Y",{"nope":1}]}\n```'
  );
  assert.equal(s.titre, 'T');
  assert.equal(s.resume.split('\n').length, 5);
  assert.deepEqual(s.taches, [{ action: 'X', responsable: 'Léa' }, { action: 'Y' }]);
  assert.throws(() => parseSummary('pas du json'), GroqError);
});

await test('summarize : transcription longue = morceaux + synthèse finale', async () => {
  const text = Array.from({ length: 3000 }, (_, i) => `Phrase ${i} importante.`).join(' ');
  const calls: boolean[] = [];
  const sleeps: number[] = [];
  const summary = await summarizeTranscript(text, {
    chat: async (_m, json) => {
      calls.push(json);
      return json ? '{"titre":"Final","resume":"ok","points_cles":[],"decisions":[],"taches":[]}' : 'notes';
    },
    sleep: async (ms) => void sleeps.push(ms),
  });
  assert.equal(summary.titre, 'Final');
  assert.ok(calls.length >= 3);
  assert.equal(calls.at(-1), true);
  assert.ok(calls.slice(0, -1).every((j) => j === false));
  assert.ok(sleeps.every((ms) => ms > 0));
});

await test('groq : 429 avec retry-after, 401, réseau, clé absente', async () => {
  const mk = (status: number, headers: Record<string, string> = {}) =>
    (async () => new Response(JSON.stringify({ error: { message: 'x' } }), { status, headers })) as typeof fetch;

  await assert.rejects(chat({ apiKey: 'k', fetchFn: mk(429, { 'retry-after': '7' }) }, [], false), (e: GroqError) => {
    return e.code === 'rate_limit' && e.retryAfterMs === 7000 && e.retryable;
  });
  await assert.rejects(chat({ apiKey: 'k', fetchFn: mk(429, { 'retry-after': '3600' }) }, [], false), (e: GroqError) => {
    return e.code === 'daily_limit' && !e.retryable;
  });
  await assert.rejects(chat({ apiKey: 'k', fetchFn: mk(401) }, [], false), (e: GroqError) => e.code === 'unauthorized');
  const down = (async () => {
    throw new TypeError('Network request failed');
  }) as typeof fetch;
  await assert.rejects(
    transcribeAudio({ apiKey: 'k', fetchFn: down }, { uri: 'file:///a.m4a', name: 'a.m4a', type: 'audio/m4a' }, 'fr'),
    (e: GroqError) => e.code === 'network'
  );
  await assert.rejects(chat({ apiKey: null }, [], false), (e: GroqError) => e.code === 'no_key');
});

await test('queue : 3 essais puis échec ; summarize attend les transcribe', async () => {
  const jobs: Job[] = [
    { id: 1, kind: 'transcribe', meetingId: 'm', segmentId: 's', status: 'pending', attempts: 0, nextAttemptAt: 0, error: null },
    { id: 2, kind: 'summarize', meetingId: 'm', segmentId: null, status: 'pending', attempts: 0, nextAttemptAt: 0, error: null },
  ];
  let clock = 0;
  const store: JobStore = {
    resetRunning: async () => {},
    nextRunnable: async (now) =>
      jobs.find(
        (j) =>
          j.status === 'pending' &&
          j.nextAttemptAt <= now &&
          (j.kind !== 'summarize' || jobs.every((o) => o.kind !== 'transcribe' || o.status === 'done'))
      ) ?? null,
    nextWakeAt: async (now) => {
      const t = jobs.filter((j) => j.status === 'pending' && j.nextAttemptAt > now).map((j) => j.nextAttemptAt);
      return t.length ? Math.min(...t) : null;
    },
    markRunning: async (id) => void (jobs.find((j) => j.id === id)!.status = 'running'),
    markDone: async (id) => void (jobs.find((j) => j.id === id)!.status = 'done'),
    markRetry: async (id, attempts, next, error) => {
      Object.assign(jobs.find((j) => j.id === id)!, { status: 'pending', attempts, nextAttemptAt: next, error });
    },
    markFailed: async (id, attempts, error) => {
      Object.assign(jobs.find((j) => j.id === id)!, { status: 'failed', attempts, error });
    },
  };

  let tries = 0;
  const order: string[] = [];
  await processQueue({
    store,
    now: () => clock,
    sleep: async (ms) => void (clock += ms),
    maxWaitMs: 10 * 60_000,
    handlers: {
      transcribe: async () => {
        tries++;
        if (tries < 3) throw new GroqError('network', 'réseau');
        order.push('transcribe');
      },
      summarize: async () => void order.push('summarize'),
      webhook: async () => {},
    },
  });
  assert.equal(tries, 3);
  assert.deepEqual(order, ['transcribe', 'summarize']);
  assert.ok(clock >= 2000 + 4000, 'attente exponentielle respectée');

  // Échec définitif : après 3 essais le job est "failed" et summarize reste bloqué.
  jobs.splice(0, jobs.length,
    { id: 1, kind: 'transcribe', meetingId: 'm', segmentId: 's', status: 'pending', attempts: 0, nextAttemptAt: 0, error: null },
    { id: 2, kind: 'summarize', meetingId: 'm', segmentId: null, status: 'pending', attempts: 0, nextAttemptAt: 0, error: null });
  await processQueue({
    store, now: () => clock, sleep: async (ms) => void (clock += ms), maxWaitMs: 10 * 60_000,
    handlers: {
      transcribe: async () => { throw new GroqError('server', 'panne'); },
      summarize: async () => { throw new Error('ne doit pas tourner'); },
      webhook: async () => {},
    },
  });
  assert.equal(jobs[0].status, 'failed');
  assert.equal(jobs[0].attempts, 3);
  assert.equal(jobs[1].status, 'pending');
});

await test('format', () => {
  assert.equal(formatClock(3725), '1:02:05');
  assert.equal(formatClock(75), '1:15');
  assert.equal(formatDurationShort(540), '9 min');
});

await test('jours et nom de fichier audio', () => {
  const now = new Date(2026, 9, 19, 15, 0).getTime();
  assert.equal(dayLabel(new Date(2026, 9, 19, 9, 0).getTime(), now), "Aujourd'hui");
  assert.equal(dayLabel(new Date(2026, 9, 18, 23, 0).getTime(), now), 'Hier');
  assert.match(dayLabel(new Date(2026, 9, 12, 9, 0).getTime(), now), /12 octobre/);
  const g = groupByDay([{ createdAt: now }, { createdAt: now - 1000 }, { createdAt: now - 86_400_000 }], now);
  assert.deepEqual(g.map((s) => [s.title, s.data.length]), [["Aujourd'hui", 2], ['Hier', 1]]);
  assert.equal(audioExportName('Point: budget/Q4', 2, 3, 'm4a'), 'Point budget Q4 - partie 2.m4a');
  assert.equal(audioExportName('Réunion', 1, 1, 'mp3'), 'Réunion.mp3');
});

await test('recherche : accents, mots multiples, extrait', () => {
  const mk = (id: string, title: string, transcript: string, resume = ''): Meeting => ({
    id, title, createdAt: 0, durationSec: 0, status: 'done', error: null, transcript,
    summary: resume ? { titre: title, resume, points_cles: [], decisions: ['Budget validé à 12 k€'], taches: [] } : null,
    finalized: true, titleEdited: false,
  });
  const list = [
    mk('a', 'Point budget', 'On a parlé du planning et des Éléphants.', 'Résumé court'),
    mk('b', 'Équipe', 'Rien sur ce sujet.'),
  ];
  assert.equal(normalize('Éléphant'), 'elephant');
  assert.deepEqual(searchMeetings(list, 'elephants').map((h) => h.meeting.id), ['a']);
  assert.deepEqual(searchMeetings(list, 'budget valide').map((h) => h.meeting.id), ['a']);
  assert.deepEqual(searchMeetings(list, 'zzz'), []);
  assert.equal(searchMeetings(list, '').length, 2);
  assert.ok(searchMeetings(list, 'budget')[0].snippet?.includes('Budget validé'));
  assert.equal(makeSnippet('a'.repeat(200) + ' cible ' + 'b'.repeat(200), 'cible', 10), '…aaaaaaaaa cible bbbbbbbbb…');
});

await test('summarize : notes trop longues fusionnées avant la synthèse finale', async () => {
  const text = Array.from({ length: 12000 }, (_, i) => `Phrase ${i} importante.`).join(' ');
  const sizes: number[] = [];
  let calls = 0;
  const big = 'x'.repeat(9000); // des notes volumineuses
  const summary = await summarizeTranscript(text, {
    chat: async (m, json) => {
      calls++;
      sizes.push(m.map((x) => x.content).join('').length);
      return json ? '{"titre":"F","resume":"ok","points_cles":[],"decisions":[],"taches":[]}' : big;
    },
    sleep: async () => {},
  });
  assert.equal(summary.titre, 'F');
  assert.ok(calls > 0);
  assert.ok(sizes.at(-1)! < sizes.length * 20_000, 'dernier appel borné');
});

await test('questions : mots utiles, extraits ciblés, budget, historique', async () => {
  const mk = (id: string, title: string, transcript: string, decision = ''): Meeting => ({
    id, title, createdAt: 1_700_000_000_000, durationSec: 60, status: 'done', error: null, transcript,
    summary: { titre: title, resume: 'Résumé.', points_cles: [], decisions: decision ? [decision] : [], taches: [] },
    finalized: true, titleEdited: false,
  });
  const filler = Array.from({ length: 800 }, (_, i) => `Phrase de remplissage numéro ${i}.`).join(' ');
  const list = [
    mk('a', 'Point budget', `${filler} Nous avons décidé un budget de 12 000 euros pour le salon. ${filler}`, 'Budget salon : 12 k€'),
    mk('b', 'Équipe produit', filler),
  ];
  assert.deepEqual(keywords("Qu'a-t-on décidé sur les budgets ?"), ['decide', 'budget']);

  const { context, sources } = buildContext(list, 'Quel budget pour le salon ?');
  assert.deepEqual(sources.map((s) => s.id), ['a']);
  assert.ok(context.includes('12 000 euros'));
  assert.ok(context.length < 4500 * 3.5 + 500, 'contexte borné');

  let received: string[] = [];
  const result = await askQuestion(list, 'Quel budget ?', [{ question: 'Avant', answer: 'Réponse précédente' }], async (messages) => {
    received = messages.map((m) => m.role);
    return ' 12 000 euros (Point budget). ';
  });
  assert.equal(result.answer, '12 000 euros (Point budget).');
  assert.deepEqual(received, ['system', 'user', 'assistant', 'user']);
  const empty = await askQuestion([], 'Question ?', [], async () => 'ne doit pas être appelé');
  assert.deepEqual(empty.sources, []);
});

function assemble(parts: Part[], source: Uint8Array): Uint8Array {
  const chunks = parts.map((p) => ('bytes' in p ? p.bytes : source.slice(p.from, p.to)));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}
const reader = (bytes: Uint8Array) => (o: number, l: number) => bytes.slice(o, Math.min(bytes.length, o + l));

await test('découpage m4a : chaque morceau est un m4a relisible, rien ne se perd', () => {
  // 1000 échantillons de 100 octets (1024 ticks à 16 kHz = 64 ms chacun)
  const samples: Sample[] = [];
  const stsd = new Uint8Array([0, 0, 0, 16, 115, 116, 115, 100, 0, 0, 0, 0, 0, 0, 0, 0]);
  const track = { timescale: 16000, stsd, samples };
  let at = 0;
  for (let i = 0; i < 1000; i++) {
    samples.push({ offset: at, size: 100, duration: 1024 });
    at += 100;
  }
  const head = buildMp4Head(track, samples);
  const audio = new Uint8Array(100_000).map((_, i) => i % 251);
  const shifted = samples.map((s) => ({ ...s, offset: s.offset + head.length }));
  const file = new Uint8Array(head.length + audio.length);
  file.set(buildMp4Head({ ...track, samples: shifted }, shifted));
  file.set(audio, head.length);

  const pieces = planSplit('m4a', file.length, reader(file), 30_000);
  assert.ok(pieces.length >= 3 && pieces.length <= 5, `morceaux : ${pieces.length}`);
  const total = pieces.reduce((n, p) => n + p.durationSec, 0);
  assert.ok(Math.abs(total - 64) <= pieces.length, `durée totale ${total}`);

  const rebuilt: number[] = [];
  for (const piece of pieces) {
    const bytes = assemble(piece.parts, file);
    assert.ok(bytes.length <= 30_000, 'morceau sous la limite');
    assert.equal(String.fromCharCode(...bytes.slice(4, 8)), 'ftyp');
    // Le morceau est lui-même un m4a valide : on peut le relire et retrouver les mêmes octets audio.
    const again = planSplit('m4a', bytes.length, reader(bytes), 10_000_000);
    assert.equal(again.length, 1);
    const headLength = (piece.parts[0] as { bytes: Uint8Array }).bytes.length;
    const audioOnly = assemble(again[0].parts.slice(1), bytes);
    assert.equal(audioOnly.length, bytes.length - headLength);
    rebuilt.push(...audioOnly);
  }
  assert.deepEqual(Uint8Array.from(rebuilt), audio);
});

await test('découpage mp3 : coupe sur une trame et couvre tout le fichier', () => {
  const frame = (n: number) => {
    const f = new Uint8Array(417).fill(n);
    f.set([0xff, 0xfb, 0x90, 0x00]); // MPEG1 couche 3, 128 kb/s
    return f;
  };
  const file = new Uint8Array(417 * 200);
  for (let i = 0; i < 200; i++) file.set(frame(i), i * 417);
  const pieces = planSplit('mp3', file.length, reader(file), 20_000);
  assert.ok(pieces.length >= 4);
  let next = 0;
  for (const p of pieces) {
    const part = p.parts[0] as { from: number; to: number };
    assert.equal(part.from, next);
    if (part.from > 0) assert.equal(file[part.from], 0xff);
    next = part.to;
  }
  assert.equal(next, file.length);
});

await test('découpage wav : chaque morceau a son en-tête et une taille juste', () => {
  const data = new Uint8Array(100_000).map((_, i) => i % 7);
  const file = new Uint8Array(44 + data.length);
  const v = new DataView(file.buffer);
  file.set([82, 73, 70, 70], 0); // RIFF
  v.setUint32(4, 36 + data.length, true);
  file.set([87, 65, 86, 69, 102, 109, 116, 32], 8); // WAVEfmt
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  file.set([100, 97, 116, 97], 36); // data
  v.setUint32(40, data.length, true);
  file.set(data, 44);

  const pieces = planSplit('wav', file.length, reader(file), 30_000);
  assert.equal(pieces.length, 4);
  let samples = 0;
  for (const p of pieces) {
    const bytes = assemble(p.parts, file);
    assert.ok(bytes.length <= 30_000);
    assert.equal(new DataView(bytes.buffer).getUint32(40, true), bytes.length - 44);
    samples += bytes.length - 44;
  }
  assert.equal(samples, data.length);
});

await test('repères de temps : format, lecture, décalage, lignes', () => {
  assert.equal(formatStamp(754), '12:34');
  assert.equal(formatStamp(4325), '1:12:05');
  assert.equal(parseStamp('(12:35)'), 755);
  assert.equal(parseStamp('[1:21:05]'), 4865);
  assert.equal(parseStamp('bientôt'), undefined);
  const text = buildTimedTranscript([
    { start: 0, text: 'Bonjour.' },
    { start: 10, text: 'On commence.' },
    { start: 45, text: 'Premier sujet.' },
  ]);
  assert.equal(text, '[00:00] Bonjour. On commence.\n[00:45] Premier sujet.');
  const shifted = shiftTimestamps(text, 3600);
  assert.equal(shifted, '[1:00:00] Bonjour. On commence.\n[1:00:45] Premier sujet.');
  const lines = parseTranscriptLines(shifted);
  assert.equal(lines[1].sec, 3645);
  assert.equal(lineIndexAt(lines, 3650), 1);
  assert.equal(lineIndexAt(lines, 3601), 0);
});

await test('transcription : le texte reçoit les repères de Whisper', async () => {
  const fetchFn = (async () =>
    new Response(JSON.stringify({ text: 'a b', segments: [{ start: 0, text: ' a' }, { start: 40, text: ' b' }] }), { status: 200 })) as typeof fetch;
  const out = await transcribeAudio({ apiKey: 'k', fetchFn }, { uri: 'x', name: 'a.m4a', type: 'audio/m4a' }, 'fr');
  assert.equal(out, '[00:00] a\n[00:40] b');
});

await test('synthèse détaillée : sections et minutes lues, tolérant', () => {
  const s = parseSummary(JSON.stringify({
    titre: 'T', resume: 'r', points_cles: [], decisions: [],
    taches: [{ action: 'Envoyer', minute: '00:25' }],
    sections: [
      { rubrique: 'Blocages et risques', titre: 'Paiement', minute: '25:06', details: ['a', 'b'] },
      { titre: 'Sans rubrique', details: ['c'], minute: 'inconnu' },
      { rien: true },
    ],
  }));
  assert.equal(s.sections?.length, 2);
  assert.equal(s.sections?.[0].minute, 1506);
  assert.equal(s.sections?.[1].rubrique, 'Sujet');
  assert.equal(s.sections?.[1].minute, undefined);
  assert.equal(s.taches[0].minute, 25);
});

await test('synthèse : fil conducteur et sujets principal / secondaire', () => {
  const s = parseSummary(JSON.stringify({
    titre: 'T', resume: 'r', points_cles: [], decisions: [], taches: [],
    fil_conducteur: { titre: 'Lancer la plateforme', description: 'Enjeu.', minutes: ['00:00', '12:35', 'x'] },
    sections: [{ role: 'principal', rubrique: 'Avancée', titre: 'A', details: ['a'] }, { role: 'bizarre', rubrique: 'Digression', titre: 'B', details: ['b'] }],
  }));
  assert.deepEqual(s.fil_conducteur?.minutes, [0, 755]);
  assert.equal(s.sections?.[0].role, 'principal');
  assert.equal(s.sections?.[1].role, undefined);
  assert.equal(parseSummary('{"titre":"T","resume":"","points_cles":[],"decisions":[],"taches":[]}').fil_conducteur, undefined);
});

console.log(`\n${passed} tests OK`);
