// Découpe d'un gros fichier audio en morceaux qui passent sous la limite de Groq.
// TypeScript pur : on ne touche pas aux fichiers ici, on prépare seulement un "plan".
//
//   m4a / mp4 : on relit la table des échantillons et on fabrique un petit fichier valide par morceau
//   mp3       : coupure aux frontières de trames (un mp3 se recolle et se coupe à l'octet près)
//   wav       : nouvel en-tête de 44 octets par morceau

/** Lit `length` octets à partir de `offset` (moins si on dépasse la fin du fichier). */
export type Reader = (offset: number, length: number) => Uint8Array;

/** Un bout du futur fichier : des octets à écrire tels quels, ou une plage à copier de l'original. */
export type Part = { bytes: Uint8Array } | { from: number; to: number };

export interface Piece {
  parts: Part[];
  durationSec: number;
}

export class SplitError extends Error {}

const FORMAT_ERROR = "Impossible de découper ce fichier (format audio inhabituel). Exportez-le en plus court depuis l'app Dictaphone ou Fichiers.";

/** Prépare le découpage de `size` octets en morceaux d'au plus `maxBytes`. */
export function planSplit(ext: string, size: number, read: Reader, maxBytes: number): Piece[] {
  try {
    switch (ext) {
      case 'm4a':
      case 'mp4':
        return planMp4(size, read, maxBytes);
      case 'mp3':
        return planMp3(size, read, maxBytes);
      case 'wav':
        return planWav(size, read, maxBytes);
    }
  } catch (e) {
    if (e instanceof SplitError) throw e;
    throw new SplitError(FORMAT_ERROR);
  }
  throw new SplitError(FORMAT_ERROR);
}

// ------------------------------------------------------------
// Utilitaires binaires
// ------------------------------------------------------------

function view(b: Uint8Array): DataView {
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
}
const u32 = (b: Uint8Array, o: number) => view(b).getUint32(o);
const u16 = (b: Uint8Array, o: number) => view(b).getUint16(o);
const u32le = (b: Uint8Array, o: number) => view(b).getUint32(o, true);
const tag = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

function concat(...arrays: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let pos = 0;
  for (const a of arrays) {
    out.set(a, pos);
    pos += a.length;
  }
  return out;
}

function be32(...values: number[]): Uint8Array {
  return be32List(values);
}

/** Même chose avec un tableau (évite de passer des dizaines de milliers d'arguments). */
function be32List(values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const v = view(out);
  values.forEach((n, i) => v.setUint32(i * 4, n >>> 0));
  return out;
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

// ------------------------------------------------------------
// m4a / mp4
// ------------------------------------------------------------

interface Box {
  type: string;
  start: number;
  end: number;
  body: number; // début du contenu (après l'en-tête de la boîte)
}

/** Liste les boîtes d'un tampon entre `from` et `to`. */
function children(buf: Uint8Array, from: number, to: number): Box[] {
  const boxes: Box[] = [];
  let pos = from;
  while (pos + 8 <= to) {
    let size = u32(buf, pos);
    let header = 8;
    if (size === 1) {
      size = u32(buf, pos + 8) * 2 ** 32 + u32(buf, pos + 12);
      header = 16;
    } else if (size === 0) {
      size = to - pos;
    }
    if (size < header || pos + size > to) break;
    boxes.push({ type: tag(buf, pos + 4), start: pos, end: pos + size, body: pos + header });
    pos += size;
  }
  return boxes;
}

function find(boxes: Box[], type: string): Box {
  const box = boxes.find((b) => b.type === type);
  if (!box) throw new SplitError(FORMAT_ERROR);
  return box;
}

export interface Sample {
  offset: number;
  size: number;
  duration: number;
}

export interface Mp4Track {
  timescale: number;
  stsd: Uint8Array;
  samples: Sample[];
}

/** Trouve la piste audio dans la boîte `moov` et en déduit la liste des échantillons. */
function parseMoov(moov: Uint8Array): Mp4Track {
  const top = children(moov, 8, moov.length);
  const traks = top.filter((b) => b.type === 'trak');

  for (const trak of traks) {
    const mdia = find(children(moov, trak.body, trak.end), 'mdia');
    const mdiaKids = children(moov, mdia.body, mdia.end);
    const hdlr = find(mdiaKids, 'hdlr');
    if (tag(moov, hdlr.body + 8) !== 'soun') continue;

    const mdhd = find(mdiaKids, 'mdhd');
    const timescale = u32(moov, mdhd.body + (moov[mdhd.body] === 1 ? 20 : 12));

    const minf = find(mdiaKids, 'minf');
    const stbl = find(children(moov, minf.body, minf.end), 'stbl');
    const t = children(moov, stbl.body, stbl.end);

    const stsdBox = find(t, 'stsd');
    const stts = find(t, 'stts');
    const stsz = find(t, 'stsz');
    const stsc = find(t, 'stsc');
    const stco = t.find((b) => b.type === 'stco') ?? t.find((b) => b.type === 'co64');
    if (!stco) throw new SplitError(FORMAT_ERROR);

    // durées
    const durations: number[] = [];
    const sttsCount = u32(moov, stts.body + 4);
    for (let i = 0; i < sttsCount; i++) {
      const count = u32(moov, stts.body + 8 + i * 8);
      const delta = u32(moov, stts.body + 12 + i * 8);
      for (let k = 0; k < count; k++) durations.push(delta);
    }

    // tailles
    const fixedSize = u32(moov, stsz.body + 4);
    const sampleCount = u32(moov, stsz.body + 8);
    const sizes: number[] = [];
    for (let i = 0; i < sampleCount; i++) sizes.push(fixedSize || u32(moov, stsz.body + 12 + i * 4));

    // positions des "chunks"
    const chunkCount = u32(moov, stco.body + 4);
    const chunkOffsets: number[] = [];
    for (let i = 0; i < chunkCount; i++) {
      chunkOffsets.push(
        stco.type === 'stco'
          ? u32(moov, stco.body + 8 + i * 4)
          : u32(moov, stco.body + 8 + i * 8) * 2 ** 32 + u32(moov, stco.body + 12 + i * 8)
      );
    }

    // échantillons par chunk
    const runCount = u32(moov, stsc.body + 4);
    const runs: { first: number; perChunk: number }[] = [];
    for (let i = 0; i < runCount; i++) {
      runs.push({ first: u32(moov, stsc.body + 8 + i * 12), perChunk: u32(moov, stsc.body + 12 + i * 12) });
    }

    const samples: Sample[] = [];
    let index = 0;
    for (let c = 0; c < chunkOffsets.length; c++) {
      let perChunk = 0;
      for (const r of runs) if (r.first <= c + 1) perChunk = r.perChunk;
      let offset = chunkOffsets[c];
      for (let k = 0; k < perChunk && index < sizes.length; k++, index++) {
        samples.push({ offset, size: sizes[index], duration: durations[index] ?? durations[durations.length - 1] ?? 1024 });
        offset += sizes[index];
      }
    }
    if (samples.length === 0 || !timescale) throw new SplitError(FORMAT_ERROR);

    return { timescale, stsd: moov.slice(stsdBox.start, stsdBox.end), samples };
  }
  throw new SplitError("Ce fichier ne contient pas de piste audio.");
}

function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concat(...payload);
  return concat(be32(body.length + 8), ascii(type), body);
}

const MATRIX = be32(0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000);

/** Construit un fichier m4a minimal (ftyp + moov + en-tête mdat) pour une série d'échantillons. */
export function buildMp4Head(track: Mp4Track, samples: Sample[]): Uint8Array {
  const { timescale } = track;
  const duration = samples.reduce((n, s) => n + s.duration, 0);

  const ftyp = box('ftyp', ascii('M4A '), be32(0), ascii('M4A '), ascii('mp42'), ascii('isom'));

  // durées : regroupées par valeur identique
  const sttsEntries: number[] = [];
  for (const s of samples) {
    const n = sttsEntries.length;
    if (n && sttsEntries[n - 1] === s.duration) sttsEntries[n - 2] += 1;
    else sttsEntries.push(1, s.duration);
  }

  const buildMoov = (chunkOffset: number) => {
    const mvhd = box(
      'mvhd',
      be32(0, 0, 0, timescale, duration, 0x00010000),
      new Uint8Array([0x01, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      MATRIX,
      new Uint8Array(24),
      be32(2)
    );
    const tkhd = box(
      'tkhd',
      be32(3, 0, 0, 1, 0, duration),
      new Uint8Array(8),
      new Uint8Array([0, 0, 0, 0, 0x01, 0x00, 0, 0]),
      MATRIX,
      be32(0, 0)
    );
    const mdhd = box('mdhd', be32(0, 0, 0, timescale, duration), new Uint8Array([0x55, 0xc4, 0, 0]));
    const hdlr = box('hdlr', be32(0, 0), ascii('soun'), new Uint8Array(12), new Uint8Array([0]));
    const smhd = box('smhd', be32(0, 0));
    const dinf = box('dinf', box('dref', be32(0, 1), box('url ', be32(1))));
    const stts = box('stts', be32(0, sttsEntries.length / 2), be32List(sttsEntries));
    const stsc = box('stsc', be32(0, 1, 1, samples.length, 1));
    const stsz = box('stsz', be32(0, 0, samples.length), be32List(samples.map((s) => s.size)));
    const stco = box('stco', be32(0, 1, chunkOffset));
    const stbl = box('stbl', track.stsd, stts, stsc, stsz, stco);
    const minf = box('minf', smhd, dinf, stbl);
    const mdia = box('mdia', mdhd, hdlr, minf);
    return box('moov', mvhd, box('trak', tkhd, mdia));
  };

  const moovSize = buildMoov(0).length;
  const dataSize = samples.reduce((n, s) => n + s.size, 0);
  const moov = buildMoov(ftyp.length + moovSize + 8);
  return concat(ftyp, moov, be32(dataSize + 8), ascii('mdat'));
}

function planMp4(size: number, read: Reader, maxBytes: number): Piece[] {
  // Les boîtes de premier niveau : on cherche `moov` (souvent placée à la fin du fichier).
  let moov: Uint8Array | null = null;
  let pos = 0;
  while (pos + 8 <= size) {
    const head = read(pos, 16);
    let boxSize = u32(head, 0);
    if (boxSize === 1) boxSize = u32(head, 8) * 2 ** 32 + u32(head, 12);
    else if (boxSize === 0) boxSize = size - pos;
    if (boxSize < 8) break;
    if (tag(head, 4) === 'moov') {
      moov = read(pos, boxSize);
      break;
    }
    pos += boxSize;
  }
  if (!moov) throw new SplitError(FORMAT_ERROR);

  const track = parseMoov(moov);

  // On remplit chaque morceau jusqu'à la taille maximale (moins une marge pour la table d'index).
  const groups: Sample[][] = [];
  let current: Sample[] = [];
  let currentBytes = 0;
  for (const s of track.samples) {
    const indexCost = 12; // taille + durée par échantillon dans le nouvel index
    if (current.length && currentBytes + s.size + indexCost > maxBytes - 4096) {
      groups.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(s);
    currentBytes += s.size + indexCost;
  }
  if (current.length) groups.push(current);

  return groups.map((samples) => {
    const parts: Part[] = [{ bytes: buildMp4Head(track, samples) }];
    // Plages contiguës fusionnées pour limiter le nombre de lectures.
    let from = samples[0].offset;
    let to = from;
    for (const s of samples) {
      if (s.offset === to) {
        to += s.size;
      } else {
        parts.push({ from, to });
        from = s.offset;
        to = from + s.size;
      }
    }
    parts.push({ from, to });
    const ticks = samples.reduce((n, s) => n + s.duration, 0);
    return { parts, durationSec: Math.round(ticks / track.timescale) };
  });
}

// ------------------------------------------------------------
// mp3
// ------------------------------------------------------------

const MP3_KBPS_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MP3_KBPS_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

function isMp3Sync(b: Uint8Array, i: number): boolean {
  return b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0 && (b[i + 1] & 0x06) !== 0 && (b[i + 2] & 0xf0) !== 0xf0;
}

/** Premier début de trame mp3 à partir de `from` (ou `from` si on n'en trouve pas). */
function nextMp3Frame(read: Reader, size: number, from: number): number {
  const window = read(from, Math.min(8192, size - from));
  for (let i = 0; i + 3 < window.length; i++) if (isMp3Sync(window, i)) return from + i;
  return from;
}

function planMp3(size: number, read: Reader, maxBytes: number): Piece[] {
  const head = read(0, 10);
  let audioStart = 0;
  if (tag(head, 0).startsWith('ID3')) {
    audioStart = 10 + ((head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9]);
  }
  audioStart = nextMp3Frame(read, size, audioStart);

  // Débit d'après la première trame ; à défaut, 128 kb/s.
  const frame = read(audioStart, 4);
  const index = frame[2] >> 4;
  const mpeg1 = ((frame[1] >> 3) & 3) === 3;
  const kbps = (mpeg1 ? MP3_KBPS_V1 : MP3_KBPS_V2)[index] || 128;
  const bytesPerSec = (kbps * 1000) / 8;

  const cuts: number[] = [0];
  let pos = audioStart;
  while (size - pos > maxBytes) {
    pos = nextMp3Frame(read, size, pos + maxBytes - 8192);
    cuts.push(pos);
  }
  cuts.push(size);

  const pieces: Piece[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const from = cuts[i];
    const to = cuts[i + 1];
    pieces.push({ parts: [{ from, to }], durationSec: Math.round((to - from) / bytesPerSec) });
  }
  return pieces;
}

// ------------------------------------------------------------
// wav
// ------------------------------------------------------------

function planWav(size: number, read: Reader, maxBytes: number): Piece[] {
  let fmt: Uint8Array | null = null;
  let dataStart = -1;
  let dataSize = 0;
  let pos = 12;
  while (pos + 8 <= size) {
    const head = read(pos, 8);
    const chunkSize = u32le(head, 4);
    const name = tag(head, 0);
    if (name === 'fmt ') fmt = read(pos + 8, 16);
    if (name === 'data') {
      dataStart = pos + 8;
      dataSize = Math.min(chunkSize, size - dataStart);
      break;
    }
    pos += 8 + chunkSize + (chunkSize % 2);
  }
  if (!fmt || dataStart < 0) throw new SplitError(FORMAT_ERROR);

  const byteRate = u32le(fmt, 8) || 32000;
  const blockAlign = u16le(fmt, 12) || 2;
  const perPiece = Math.floor((maxBytes - 44) / blockAlign) * blockAlign;

  const pieces: Piece[] = [];
  for (let start = 0; start < dataSize; start += perPiece) {
    const length = Math.min(perPiece, dataSize - start);
    const header = new Uint8Array(44);
    const v = view(header);
    header.set(ascii('RIFF'), 0);
    v.setUint32(4, 36 + length, true);
    header.set(ascii('WAVEfmt '), 8);
    v.setUint32(16, 16, true);
    header.set(fmt, 20);
    header.set(ascii('data'), 36);
    v.setUint32(40, length, true);
    pieces.push({
      parts: [{ bytes: header }, { from: dataStart + start, to: dataStart + start + length }],
      durationSec: Math.round(length / byteRate),
    });
  }
  return pieces;
}

function u16le(b: Uint8Array, o: number): number {
  return view(b).getUint16(o, true);
}
