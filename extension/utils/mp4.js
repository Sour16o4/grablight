// Joins a stream's separate sound track into its video when both are fragmented MP4 (fMP4/CMAF).
// Same job as ts.js, for the other HLS packaging. Pure JS, no browser APIs.
//
// How: each side has an init piece (a `moov` listing its tracks) and fragments (`moof` + `mdat`).
// We add the sound's `trak` and `trex` to the video's `moov` under a free track id, then copy the sound
// fragments with that id written into their `tfhd`, and interleave them between the video fragments.
// ponytail: one video track and one sound track; sidx/styp boxes are dropped; fragments are interleaved
// a whole piece at a time. Boxes bigger than 4 GB (64-bit sizes) are not supported.

const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const put32 = (b, o, v) => new DataView(b.buffer, b.byteOffset).setUint32(o, v);
const type = (b, o) => String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);

// The boxes directly inside b[start, end): [{ type, at, size }].
function boxes(b, start = 0, end = b.length) {
  const out = [];
  for (let o = start; o + 8 <= end; ) {
    const size = u32(b, o);
    if (size < 8 || o + size > end) throw new Error('Not a plain fragmented MP4 file');
    out.push({ type: type(b, o), at: o, size });
    o += size;
  }
  return out;
}
const child = (b, box, t, skip = 8) => boxes(b, box.at + skip, box.at + box.size).find((x) => x.type === t);

// A trak's track id and kind ('vide', 'soun'...).
function trackInfo(b, trak) {
  const tkhd = child(b, trak, 'tkhd');
  const idAt = tkhd.at + (b[tkhd.at + 8] === 1 ? 28 : 20); // after version/flags and the two times
  const hdlr = child(b, child(b, trak, 'mdia'), 'hdlr');
  return { idAt, id: u32(b, idAt), kind: String.fromCharCode(...b.subarray(hdlr.at + 16, hdlr.at + 20)) };
}

// -> the joined init piece: the video's, with the sound's track added.
export function mergeInit(videoInit, soundInit) {
  const v = new Uint8Array(videoInit);
  const a = new Uint8Array(soundInit);
  const vmoov = boxes(v).find((x) => x.type === 'moov');
  const amoov = boxes(a).find((x) => x.type === 'moov');
  if (!vmoov || !amoov) throw new Error('Not a plain fragmented MP4 file');

  const vtraks = boxes(v, vmoov.at + 8, vmoov.at + vmoov.size).filter((x) => x.type === 'trak');
  const soundTrak = boxes(a, amoov.at + 8, amoov.at + amoov.size)
    .filter((x) => x.type === 'trak')
    .find((t) => trackInfo(a, t).kind === 'soun');
  if (!soundTrak) throw new Error('The sound track is not in a format that can be joined');
  if (vtraks.some((t) => trackInfo(v, t).kind === 'soun')) throw new Error('The video already has sound');

  const oldId = trackInfo(a, soundTrak).id;
  const newId = Math.max(...vtraks.map((t) => trackInfo(v, t).id)) + 1;
  const trak = a.slice(soundTrak.at, soundTrak.at + soundTrak.size);
  put32(trak, trackInfo(trak, { at: 0, size: trak.length }).idAt, newId);

  const amvex = child(a, amoov, 'mvex');
  const atrex = amvex && boxes(a, amvex.at + 8, amvex.at + amvex.size).find((x) => x.type === 'trex' && u32(a, x.at + 12) === oldId);
  const vmvex = child(v, vmoov, 'mvex');
  if (!atrex || !vmvex) throw new Error('Not a plain fragmented MP4 file');
  const trex = a.slice(atrex.at, atrex.at + atrex.size);
  put32(trex, 12, newId);

  // Insert from the back so earlier offsets stay valid: the trex at the end of the video's mvex, the trak after its last trak.
  const lastTrak = vtraks[vtraks.length - 1];
  const inserts = [
    [vmvex.at + vmvex.size, trex],
    [lastTrak.at + lastTrak.size, trak],
  ].sort((x, y) => y[0] - x[0]);
  let moov = v.slice(vmoov.at, vmoov.at + vmoov.size);
  for (const [at, bytes] of inserts) {
    const rel = at - vmoov.at;
    const grown = new Uint8Array(moov.length + bytes.length);
    grown.set(moov.subarray(0, rel));
    grown.set(bytes, rel);
    grown.set(moov.subarray(rel), rel + bytes.length);
    moov = grown;
  }
  put32(moov, 0, moov.length);
  const mvex = boxes(moov, 8).find((x) => x.type === 'mvex');
  put32(moov, mvex.at, mvex.size + trex.length);
  const mvhd = boxes(moov, 8).find((x) => x.type === 'mvhd');
  put32(moov, mvhd.at + (moov[mvhd.at + 8] === 1 ? 8 + 4 + 8 + 8 + 4 + 8 + 4 + 2 + 10 + 36 + 24 : 8 + 4 + 4 + 4 + 4 + 4 + 4 + 2 + 10 + 36 + 24), newId + 1);

  const pieces = boxes(v).map((x) => (x.type === 'moov' ? moov : v.subarray(x.at, x.at + x.size)));
  return { init: concat(pieces), newId };
}

// A sound fragment with its track id changed and its sequence number set; sidx/styp boxes dropped.
export function retag(fragment, trackId, sequence) {
  const f = new Uint8Array(fragment);
  const kept = [];
  for (const box of boxes(f)) {
    if (box.type === 'moof') {
      const out = f.slice(box.at, box.at + box.size);
      const mfhd = child(out, { at: 0, size: out.length }, 'mfhd');
      put32(out, mfhd.at + 12, sequence);
      for (const traf of boxes(out, 8).filter((x) => x.type === 'traf')) put32(out, child(out, traf, 'tfhd').at + 12, trackId);
      kept.push(out);
    } else if (box.type !== 'sidx' && box.type !== 'styp') kept.push(f.subarray(box.at, box.at + box.size));
  }
  return concat(kept);
}

const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) (out.set(p, at), (at += p.length));
  return out;
};

// Video fragments with the sound fragments interleaved. Returns the pieces of the final file, init first.
export function mergeMp4(videoInit, videoFragments, soundInit, soundFragments) {
  const { init, newId } = mergeInit(videoInit, soundInit);
  const out = [init];
  let nextSound = 0;
  let sequence = 1;
  videoFragments.forEach((frag, i) => {
    out.push(new Uint8Array(frag));
    const due = Math.ceil(((i + 1) * soundFragments.length) / videoFragments.length);
    for (; nextSound < due; nextSound++) out.push(retag(soundFragments[nextSound], newId, 100000 + sequence++));
  });
  return out;
}
