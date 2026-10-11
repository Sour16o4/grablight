// Run: node utils/ts.test.js
// Builds two tiny MPEG-TS files by hand (video with its tables, sound with its own) and checks the join.
import { crc32, mergeTs, readTables } from './ts.js';

const eq = (a, b) => console.assert(a === b, `expected ${b}, got ${a}`);

function packet(pid, payload, pusi = true) {
  const p = new Uint8Array(188).fill(0xff);
  p.set([0x47, (pusi ? 0x40 : 0) | (pid >> 8), pid & 0xff, 0x10], 0);
  p.set(payload, 4);
  return p;
}
function table(id, body) {
  const t = new Uint8Array(3 + body.length + 4);
  t.set([id, 0xb0 | ((body.length + 4) >> 8), (body.length + 4) & 0xff, ...body]);
  new DataView(t.buffer).setUint32(t.length - 4, crc32(t.subarray(0, t.length - 4)));
  return t;
}
const pat = (pmtPid) => packet(0, [0, ...table(0, [0, 1, 0xc1, 0, 0, 0, 1, 0xe0 | (pmtPid >> 8), pmtPid & 0xff])]);
const pmt = (pmtPid, pcr, es) =>
  packet(pmtPid, [0, ...table(2, [0, 1, 0xc1, 0, 0, 0xe0 | (pcr >> 8), pcr & 0xff, 0xf0, 0, ...es.flatMap(([t, pid]) => [t, 0xe0 | (pid >> 8), pid & 0xff, 0xf0, 0])])]);
const file = (...pkts) => { const f = new Uint8Array(188 * pkts.length); pkts.forEach((p, i) => f.set(p, i * 188)); return f.buffer; };

const video = file(pat(0x1000), pmt(0x1000, 0x100, [[0x1b, 0x100]]), packet(0x100, [1, 2, 3]));
const sound = file(pat(0x1000), pmt(0x1000, 0x100, [[0x0f, 0x100]]), packet(0x100, [9, 9, 9]));

const out = mergeTs([video], [sound]);
const joined = new Uint8Array(out.reduce((n, x) => n + x.length, 0));
let at = 0;
out.forEach((x) => (joined.set(x, at), (at += x.length)));

const t = readTables(joined);
eq(t.streams.length, 2); // the video's table now lists both
eq(t.streams[1].type, 0x0f);
eq(t.streams[1].pid === 0x100, false); // the sound got its own PID, no clash with the video
eq(crc32(t.pmt), 0); // a table with a correct CRC checks to zero
const soundPackets = [...Array(joined.length / 188).keys()].filter((i) => ((joined[i * 188 + 1] & 0x1f) << 8 | joined[i * 188 + 2]) === t.streams[1].pid);
eq(soundPackets.length, 1);
eq(joined[soundPackets[0] * 188 + 4], 9); // and carries the sound's data

let err = '';
try { mergeTs([video], [video]); } catch (e) { err = e.message; }
eq(err, 'The sound track is not in a format that can be joined');
// packed audio: a bare ADTS AAC file (one 20-byte frame) is wrapped into TS on its own PID
const adts = new Uint8Array(20);
adts.set([0xff, 0xf1, 0x50, 0x00, 0x02, 0x9f, 0xfc]);
const packedOut = mergeTs([video], [adts.buffer]);
const pj = new Uint8Array(packedOut.reduce((n, x) => n + x.length, 0));
let pat2 = 0;
packedOut.forEach((x) => (pj.set(x, pat2), (pat2 += x.length)));
const pt = readTables(pj);
eq(pt.streams[1].type, 0x0f);
const pes = [...Array(pj.length / 188).keys()].find((i) => ((pj[i * 188 + 1] & 0x1f) << 8 | pj[i * 188 + 2]) === pt.streams[1].pid);
eq(pj.slice(pes * 188 + 4).findIndex((x, i, a) => x === 0 && a[i + 1] === 0 && a[i + 2] === 1 && a[i + 3] === 0xc0) >= 0, true);
// packed MP3: one MPEG-1 layer III frame (128 kbps, 44.1 kHz = 417 bytes) becomes a TS stream of type 0x03
const mp3 = new Uint8Array(417 * 2); // two frames
mp3.set([0xff, 0xfb, 0x90, 0x00]);
mp3.set([0xff, 0xfb, 0x90, 0x00], 417);
const mp3Out = mergeTs([video], [mp3.buffer]);
const mj = new Uint8Array(mp3Out.reduce((n, x) => n + x.length, 0));
let mat = 0;
mp3Out.forEach((x) => (mj.set(x, mat), (mat += x.length)));
eq(readTables(mj).streams[1].type, 0x03);
console.log('ts.js checks done');
