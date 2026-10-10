// Joins a stream's separate sound track into its video, when both are MPEG-TS (the usual HLS case).
// Many sites ship video and audio as two playlists; just concatenating the pieces gives a silent video.
// Pure JS, no browser APIs, so hls.test.js can check it in plain node.
//
// How: every TS file starts with a PAT -> PMT (the table listing its streams). We keep the video's
// tables, add the audio stream to its PMT under a free PID, rewrite the audio packets to that PID,
// and interleave the audio pieces between the video pieces.
// Sound pieces can be TS too, or "packed audio": bare AAC (ADTS) files, which we wrap into TS packets.
// ponytail: TS sound (AAC/MP3/AC-3) and packed AAC only; packed MP3/AC-3 and fMP4 streams are not merged.
// ponytail: pieces are interleaved a whole piece at a time, not packet by packet by timestamp.
const PKT = 188;
const AUDIO_TYPES = [0x0f, 0x11, 0x03, 0x04, 0x81, 0x87]; // AAC, AAC LATM, MPEG audio, AC-3, E-AC-3

const pidOf = (b, o) => ((b[o + 1] & 0x1f) << 8) | b[o + 2];

// MPEG-2 CRC32 (poly 0x04C11DB7, no reflection, no final xor): ends every PSI table.
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const x of bytes) {
    crc ^= x << 24;
    for (let i = 0; i < 8; i++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
  }
  return crc >>> 0;
}

// The payload of the first packet with this PID that starts a table (PUSI), minus the pointer field.
function section(bytes, pid) {
  for (let o = 0; o + PKT <= bytes.length; o += PKT) {
    if (bytes[o] !== 0x47) throw new Error('Not a plain MPEG-TS file');
    if (pidOf(bytes, o) !== pid || !(bytes[o + 1] & 0x40)) continue;
    let p = o + 4;
    if (bytes[o + 3] & 0x20) p += 1 + bytes[o + 4]; // skip the adaptation field
    p += 1 + bytes[p]; // pointer field
    const len = 3 + (((bytes[p + 1] & 0x0f) << 8) | bytes[p + 2]);
    if (p + len > o + PKT) throw new Error('Table spans several packets');
    return bytes.slice(p, p + len);
  }
  throw new Error('No stream table found');
}

// -> { pmtPid, pmt (the section), streams: [{ type, pid, info (descriptor bytes) }] }
export function readTables(bytes) {
  const pat = section(bytes, 0);
  const pmtPid = ((pat[10] & 0x1f) << 8) | pat[11]; // first program (bytes 8-9 are its number)
  const pmt = section(bytes, pmtPid);
  const streams = [];
  let p = 12 + (((pmt[10] & 0x0f) << 8) | pmt[11]);
  while (p + 5 <= pmt.length - 4) {
    const infoLen = ((pmt[p + 3] & 0x0f) << 8) | pmt[p + 4];
    streams.push({ type: pmt[p], pid: ((pmt[p + 1] & 0x1f) << 8) | pmt[p + 2], info: pmt.slice(p + 5, p + 5 + infoLen) });
    p += 5 + infoLen;
  }
  return { pmtPid, pmt, streams };
}

// A one-packet PMT: the video's table plus the audio stream.
function withAudio(pmt, add) {
  const body = pmt.slice(0, pmt.length - 4);
  const extra = [add.type, 0xe0 | (add.pid >> 8), add.pid & 0xff, 0xf0 | (add.info.length >> 8), add.info.length & 0xff, ...add.info];
  const out = new Uint8Array(body.length + extra.length + 4);
  out.set(body);
  out.set(extra, body.length);
  const len = out.length - 3;
  out[1] = (out[1] & 0xf0) | (len >> 8);
  out[2] = len & 0xff;
  new DataView(out.buffer).setUint32(out.length - 4, crc32(out.subarray(0, out.length - 4)));
  return out;
}

// videoParts, audioParts: arrays of ArrayBuffer (the pieces in order). Returns the joined Uint8Array pieces.
export function mergeTs(videoParts, audioParts) {
  const v = videoParts.map((x) => new Uint8Array(x));
  const a = audioParts.map((x) => new Uint8Array(x));
  const vt = readTables(v[0]);
  const packed = isPacked(a[0]);
  const track = packed ? { type: 0x0f, info: [], pid: 0 } : readTables(a[0]).streams.find((s) => AUDIO_TYPES.includes(s.type));
  if (!track) throw new Error('The sound track is not in a format that can be joined');
  if (vt.streams.some((s) => AUDIO_TYPES.includes(s.type))) throw new Error('The video already has sound');

  const used = new Set([0, 0x1fff, vt.pmtPid, ...vt.streams.map((s) => s.pid)]);
  let newPid = 0x101;
  while (used.has(newPid)) newPid++;
  const pmt = withAudio(vt.pmt, { ...track, pid: newPid });
  if (pmt.length > PKT - 5) throw new Error('Stream table too large');

  const out = [];
  let nextAudio = 0;
  const state = { cc: 0, next: packed ? firstPts(v[0], vt.streams.find((x) => x.type === 0x1b || x.type === 0x24 || x.type === 0x02)?.pid ?? vt.streams[0].pid) : 0 };
  const wrap = packed ? (part) => packedToTs(part, newPid, state) : (part) => audioPackets(part, track.pid, newPid);
  v.forEach((part, i) => {
    if (part.length % PKT) throw new Error('Not a plain MPEG-TS file');
    const copy = part.slice();
    for (let o = 0; o < copy.length; o += PKT) {
      if (copy[o] === 0x47 && pidOf(copy, o) === vt.pmtPid && copy[o + 1] & 0x40) {
        const cc = copy[o + 3] & 0x0f; // keep the continuity counter the video file had
        copy.fill(0xff, o + 4, o + PKT);
        copy[o + 3] = 0x10 | cc; // payload only
        copy[o + 4] = 0; // pointer field
        copy.set(pmt, o + 5);
      }
    }
    out.push(copy);
    // Audio pieces keep pace with the video ones.
    const due = Math.ceil(((i + 1) * a.length) / v.length);
    for (; nextAudio < due; nextAudio++) out.push(wrap(a[nextAudio]));
  });
  return out;
}


// --- packed audio: bare AAC (ADTS) files, usually starting with an ID3 tag that carries their start time ---
const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
const isPacked = (b) => (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xf6) === 0xf0);

// -> { start: first PTS in 90kHz ticks or null, frames: [{ at, len, rate }] }
function readPacked(b) {
  let p = 0;
  let start = null;
  while (b[p] === 0x49 && b[p + 1] === 0x44 && b[p + 2] === 0x33) {
    const size = (b[p + 6] << 21) | (b[p + 7] << 14) | (b[p + 8] << 7) | b[p + 9];
    const tag = new TextDecoder('latin1').decode(b.subarray(p + 10, p + 10 + size));
    const at = tag.indexOf('com.apple.streaming.transportStreamTimestamp');
    if (at >= 0) {
      const o = p + 10 + at + 'com.apple.streaming.transportStreamTimestamp'.length + 1;
      let v = 0n;
      for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(b[o + i]);
      start = Number(v & 0x1ffffffffn);
    }
    p += 10 + size;
  }
  const frames = [];
  while (p + 7 <= b.length && b[p] === 0xff && (b[p + 1] & 0xf0) === 0xf0) {
    const len = ((b[p + 3] & 3) << 11) | (b[p + 4] << 3) | (b[p + 5] >> 5);
    const rate = RATES[(b[p + 2] >> 2) & 15];
    if (len < 7 || !rate || p + len > b.length) break;
    frames.push({ at: p, len, rate });
    p += len;
  }
  if (!frames.length) throw new Error('The sound track is not in a format that can be joined');
  return { start, frames };
}

// The PTS (90kHz) of the first video picture, to line packed audio up when it carries no start time.
function firstPts(bytes, pid) {
  for (let o = 0; o + PKT <= bytes.length; o += PKT) {
    if (pidOf(bytes, o) !== pid || !(bytes[o + 1] & 0x40)) continue;
    let p = o + 4;
    if (bytes[o + 3] & 0x20) p += 1 + bytes[o + 4];
    if (bytes[p + 7] & 0x80) {
      const t = bytes.subarray(p + 9, p + 14);
      return ((t[0] >> 1) & 7) * 2 ** 30 + (t[1] << 22) + ((t[2] >> 1) << 15) + (t[3] << 7) + (t[4] >> 1);
    }
  }
  return 0;
}

const ptsBytes = (t) => {
  const v = BigInt(Math.round(t)) & 0x1ffffffffn;
  return [0x21 | Number((v >> 29n) & 0xen), Number((v >> 22n) & 0xffn), 0x01 | Number((v >> 14n) & 0xfen), Number((v >> 7n) & 0xffn), 0x01 | Number((v << 1n) & 0xfen)];
};

// Wraps one packed-audio file into TS packets on `pid`. state = { cc, next } carries across files:
// the continuity counter, and where the next piece starts if it has no start time of its own.
function packedToTs(part, pid, state) {
  const { start, frames } = readPacked(part);
  let t = start ?? state.next;
  const out = [];
  for (let i = 0; i < frames.length; ) {
    // a few frames per PES packet
    let j = i;
    let bytes = 0;
    while (j < frames.length && bytes + frames[j].len <= 4000) bytes += frames[j++].len;
    if (j === i) bytes = frames[j++].len; // a single big frame
    const pes = new Uint8Array(14 + bytes);
    pes.set([0, 0, 1, 0xc0, (8 + bytes) >> 8, (8 + bytes) & 0xff, 0x80, 0x80, 5, ...ptsBytes(t)]);
    let at = 14;
    for (let k = i; k < j; k++, at += frames[k - 1].len) pes.set(part.subarray(frames[k].at, frames[k].at + frames[k].len), at);
    for (let o = 0; o < pes.length; o += 184) {
      const chunk = pes.subarray(o, o + 184);
      const pkt = new Uint8Array(PKT).fill(0xff);
      pkt[0] = 0x47;
      pkt[1] = (o === 0 ? 0x40 : 0) | (pid >> 8);
      pkt[2] = pid & 0xff;
      const pad = 184 - chunk.length;
      pkt[3] = (pad ? 0x30 : 0x10) | (state.cc++ & 15);
      if (pad) {
        pkt[4] = pad - 1;
        if (pad > 1) pkt[5] = 0; // adaptation flags; the 0xff fill is the stuffing
      }
      pkt.set(chunk, 4 + pad);
      out.push(pkt);
    }
    for (let k = i; k < j; k++) t += (1024 / frames[k].rate) * 90000;
    i = j;
  }
  state.next = t;
  const joined = new Uint8Array(out.length * PKT);
  out.forEach((x, n) => joined.set(x, n * PKT));
  return joined;
}

// Only the sound packets, moved to the new PID.
function audioPackets(part, from, to) {
  if (part.length % PKT) throw new Error('Not a plain MPEG-TS file');
  const keep = [];
  for (let o = 0; o < part.length; o += PKT) if (part[o] === 0x47 && pidOf(part, o) === from) keep.push(o);
  const out = new Uint8Array(keep.length * PKT);
  keep.forEach((o, i) => {
    out.set(part.subarray(o, o + PKT), i * PKT);
    out[i * PKT + 1] = (out[i * PKT + 1] & 0xe0) | (to >> 8);
    out[i * PKT + 2] = to & 0xff;
  });
  return out;
}
