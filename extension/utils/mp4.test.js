// Run: node utils/mp4.test.js
// Builds tiny fragmented-MP4 pieces by hand (a video init and a sound init, each with one track) and checks the join.
import { mergeMp4 } from './mp4.js';

const eq = (a, b) => console.assert(a === b, `expected ${b}, got ${a}`);
const box = (t, ...kids) => {
  const body = kids.flatMap((k) => [...k]);
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set([...t].map((c) => c.charCodeAt(0)), 4);
  out.set(body, 8);
  return out;
};
const num = (...n) => n.flatMap((x) => [x >>> 24, (x >> 16) & 255, (x >> 8) & 255, x & 255]);
const zeros = (n) => new Uint8Array(n);
const init = (id, kind) =>
  box('moov', box('mvhd', zeros(4 + 96)), box('trak', box('tkhd', num(0, 0, 0, id), zeros(8)), box('mdia', box('hdlr', num(0, 0), [...kind].map((c) => c.charCodeAt(0)), zeros(13)))), box('mvex', box('trex', num(0, id), zeros(12))));
const fragment = (id, seq) => new Uint8Array([...box('moof', box('mfhd', num(0, seq)), box('traf', box('tfhd', num(0, id)))), ...box('mdat', [1, 2, 3])]);

// walk the top-level boxes of a buffer: [type, offset, size]
const walk = (b, s = 0, e = b.length) => {
  const out = [];
  for (let o = s; o < e; ) {
    const size = new DataView(b.buffer, b.byteOffset).getUint32(o);
    out.push([String.fromCharCode(...b.subarray(o + 4, o + 8)), o, size]);
    o += size;
  }
  return out;
};

const pieces = mergeMp4(init(1, 'vide'), [fragment(1, 1)], init(1, 'soun'), [fragment(1, 1)]);
const joined = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
let at = 0;
pieces.forEach((p) => (joined.set(p, at), (at += p.length)));

const top = walk(joined);
eq(top.map((x) => x[0]).join(), 'moov,moof,mdat,moof,mdat'); // init, video fragment, sound fragment
const moov = top[0];
const kids = walk(joined, moov[1] + 8, moov[1] + moov[2]);
eq(kids.map((x) => x[0]).join(), 'mvhd,trak,trak,mvex'); // a second track was added, sizes all line up
const ids = kids.filter((x) => x[0] === 'trak').map((x) => new DataView(joined.buffer).getUint32(x[1] + 8 + 8 + 12));
eq(ids.join(), '1,2'); // the sound got its own track id
const trexes = walk(joined, kids[3][1] + 8, kids[3][1] + kids[3][2]);
eq(trexes.length, 2); // and its own trex
eq(new DataView(joined.buffer).getUint32(trexes[1][1] + 12), 2);
const soundMoof = top[3];
const tfhd = walk(joined, soundMoof[1] + 8, soundMoof[1] + soundMoof[2]).find((x) => x[0] === 'traf');
eq(new DataView(joined.buffer).getUint32(tfhd[1] + 8 + 8 + 4), 2); // the sound fragment now points at track 2

let err = '';
try { mergeMp4(init(1, 'vide'), [], init(1, 'vide'), []); } catch (e) { err = e.message; }
eq(err, 'The sound track is not in a format that can be joined');
console.log('mp4.js checks done');
