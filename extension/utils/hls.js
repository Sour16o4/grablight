// Phase 6: HLS (.m3u8) streams. A stream is a playlist listing many small video pieces
// ("segments"). We read the playlist, fetch every piece (decrypting AES-128 ones),
// and join them into one file. Pure JS (fetch + WebCrypto only), so it runs in the
// offscreen page in Chrome and in plain node for the checks in hls.test.js.
//
// Not supported, reported as such instead of producing a broken file:
//   DRM (SAMPLE-AES, Widevine, FairPlay), live streams, byte-range playlists.
// ponytail: output is the raw joined pieces (.ts, or .mp4 for fMP4 streams), no remuxing;
// players like VLC and mpv open it, upgrade to a remuxer if people need a clean .mp4.
// A separate sound track (EXT-X-MEDIA TYPE=AUDIO) is fetched too and joined into the .ts by ts.js.
// If it can't be joined (fMP4, unknown format) the file is saved without sound and the result says so.

import { mergeTs } from './ts.js';

const attrs = (s) =>
  Object.fromEntries(
    [...s.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)].map((m) => [m[1], m[2].replace(/^"|"$/g, '')]),
  );

export function parsePlaylist(text, base) {
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines[0] !== '#EXTM3U') throw new Error('Not an HLS playlist');
  const abs = (u) => new URL(u, base).href;
  const out = { url: base, variants: [], audios: [], segments: [], init: null, drm: false, live: true, unsupported: '', duration: 0 };
  let seq = 0;
  let key = null;
  let variant = null; // set by STREAM-INF, consumed by the URI line after it
  let segment = false; // set by EXTINF, consumed by the URI line after it

  for (const line of lines) {
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const a = attrs(line.slice(18));
      const [w, h] = (a.RESOLUTION || '').split('x').map(Number);
      // Average bitrate is closer to the real size than the peak one, when the playlist gives it.
      variant = { bandwidth: Number(a['AVERAGE-BANDWIDTH']) || Number(a.BANDWIDTH) || 0, resolution: h ? [w, h] : null, codecs: a.CODECS || '', audio: a.AUDIO || '' };
    }
    else if (line.startsWith('#EXT-X-MEDIA:')) {
      const a = attrs(line.slice(13));
      if (a.TYPE === 'AUDIO' && a.URI) out.audios.push({ group: a['GROUP-ID'], url: abs(a.URI), default: a.DEFAULT === 'YES' });
    }
    else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) seq = Number(line.split(':')[1]) || 0;
    else if (line.startsWith('#EXT-X-KEY:')) {
      const a = attrs(line.slice(11));
      if (a.METHOD === 'NONE') key = null;
      else if (a.METHOD === 'AES-128' && (!a.KEYFORMAT || a.KEYFORMAT === 'identity')) {
        key = { uri: abs(a.URI), iv: a.IV };
      } else {
        out.drm = true; // SAMPLE-AES, Widevine, FairPlay...
        key = null;
      }
    } else if (line.startsWith('#EXT-X-MAP:')) out.init = abs(attrs(line.slice(11)).URI);
    else if (line.startsWith('#EXT-X-BYTERANGE')) out.unsupported = 'byte-range playlists';
    else if (line === '#EXT-X-ENDLIST') out.live = false;
    else if (line.startsWith('#EXTINF:')) {
      segment = true;
      out.duration += parseFloat(line.slice(8)) || 0;
    }
    else if (!line.startsWith('#')) {
      if (variant) {
        out.variants.push({ url: abs(line), ...variant });
        variant = null;
      } else if (segment) {
        out.segments.push({ url: abs(line), key, seq: seq++ });
        segment = false;
      }
    }
  }
  return out;
}

const fetchPlaylist = async (url, signal) => {
  const r = await fetch(url, { signal, credentials: 'include' });
  if (!r.ok) throw new Error(`Playlist HTTP ${r.status}`);
  return parsePlaylist(await r.text(), r.url || url);
};

// Loads a media playlist. Given a master playlist (a list of qualities) it follows the best
// quality that loads, and returns that media playlist with the master's `variants` attached.
export async function loadMedia(url, signal, depth = 0) {
  const p = await fetchPlaylist(url, signal);
  if (!p.variants.length) return p;
  if (depth >= 2) throw new Error('Playlist nesting too deep');
  let err;
  for (const v of [...p.variants].sort((x, y) => y.bandwidth - x.bandwidth)) {
    try {
      return { ...(await loadMedia(v.url, signal, depth + 1)), variants: p.variants, audios: p.audios, chosen: v.url };
    } catch (e) {
      if (signal?.aborted) throw e;
      err = e; // this quality is broken: try the next one
    }
  }
  throw err;
}

// The joined file is built in memory, so nothing bigger than this is attempted.
export const MAX_BYTES = 1.5e9;

// The qualities of a stream, best first, each with an estimated size (bitrate x length).
export function qualitiesOf(media, maxBytes = MAX_BYTES) {
  const seen = new Set();
  return media.variants
    .filter((v) => !seen.has(v.url) && seen.add(v.url))
    .sort((a, b) => b.bandwidth - a.bandwidth)
    .map((v) => {
      const height = v.resolution?.[1] || 0;
      const audioOnly = !v.resolution && !!v.codecs && !/avc|hvc|hev|vp0|av01/i.test(v.codecs);
      const est = Math.round((v.bandwidth / 8) * media.duration);
      const label = audioOnly ? 'Audio only' : height ? `${height}p${height >= 2160 ? ' (4K)' : ''}` : `${(v.bandwidth / 1e6).toFixed(1)} Mbps`;
      return { url: v.url, height, label, est, tooBig: est > maxBytes, audioOnly };
    });
}

// Choose one: pref is "best" or a number like 720 ("the best at or under 720p").
// Never picks one that is too big for memory, and prefers video over audio-only.
export function pickQuality(qualities, pref = 'best') {
  const fits = qualities.filter((q) => !q.tooBig);
  const pool = fits.some((q) => !q.audioOnly) ? fits.filter((q) => !q.audioOnly) : fits;
  if (!pool.length) return null;
  if (pref === 'best') return pool[0];
  const within = pool.filter((q) => q.height && q.height <= Number(pref));
  return within[0] || pool[pool.length - 1]; // nothing that small: the smallest there is
}

// The separate sound track that goes with a chosen quality, if the stream has one.
// master: a parsed master playlist (its variants and audios); chosen: the quality's playlist url.
// -> { track: the audio media playlist, or null, why: what stops us joining it ('' when nothing does) }
async function audioPlan(master, chosen, video, signal) {
  const group = master.variants?.find((v) => v.url === chosen)?.audio;
  const options = group ? master.audios.filter((a) => a.group === group) : [];
  const pick = options.find((a) => a.default) || options[0];
  if (!pick) return { track: null, why: '' };
  if (video.init) return { track: null, why: 'the sound is a separate track in a format that cannot be joined' };
  try {
    const track = await loadMedia(pick.url, signal);
    if (track.init || track.drm || track.live || track.unsupported || !track.segments.length) {
      return { track: null, why: 'the sound is a separate track in a format that cannot be joined' };
    }
    return { track, why: '' };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { track: null, why: "the sound track couldn't be read" };
  }
}

// What the light needs to know about a stream, without downloading it.
// audio: 'inline' (sound is in the video), 'separate' (a second track, joined when downloading),
// 'lost' (a second track that can't be joined: the download would be silent).
export async function hlsInfo(url) {
  const media = await loadMedia(url);
  const { drm, live, unsupported } = media;
  const { track, why } = await audioPlan(media, media.chosen, media);
  return { hlsChecked: true, drm, live, unsupported, qualities: qualitiesOf(media), audio: track ? 'separate' : why ? 'lost' : 'inline' };
}

// AES-128 IV: the playlist's explicit IV, or the segment's sequence number as 16 big-endian bytes.
export function ivFor(segment) {
  const iv = new Uint8Array(16);
  if (segment.key.iv) {
    const hex = segment.key.iv.replace(/^0x/i, '').padStart(32, '0');
    for (let i = 0; i < 16; i++) iv[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  } else {
    new DataView(iv.buffer).setUint32(12, segment.seq);
  }
  return iv;
}

// signal: an AbortSignal; aborting it stops the download and throws.
// variantUrl: the quality the user chose. Without it, the best quality that fits in memory.
export async function downloadHls(url, onProgress = () => {}, signal, maxBytes = MAX_BYTES, variantUrl) {
  let p = await loadMedia(variantUrl || url, signal);
  // The master playlist knows which sound track goes with which quality. A chosen quality's own
  // playlist doesn't, so then the master is read again.
  let master = p;
  let chosen = variantUrl || p.chosen || url;
  if (variantUrl) master = await fetchPlaylist(url, signal).catch(() => ({ variants: [], audios: [] }));
  if (!variantUrl && p.variants.length) {
    let qs = qualitiesOf(p, maxBytes);
    if (!pickQuality(qs)) throw new Error(`Too large to join in memory (over ${Math.round((maxBytes / 1e9) * 10) / 10} GB)`);
    for (;;) {
      const q = pickQuality(qs);
      if (!q || q.url === p.url) break; // the playlist we already loaded is the pick (or nothing else is left)
      try {
        p = await loadMedia(q.url, signal);
        chosen = q.url;
        break;
      } catch (e) {
        if (signal?.aborted) throw e;
        qs = qs.filter((x) => x !== q); // this quality is broken: try the next best
      }
    }
  }
  if (p.drm) throw new Error('Protected by DRM, cannot be downloaded');
  if (p.live) throw new Error("Live streams can't be downloaded");
  if (p.unsupported) throw new Error(`Not supported yet: ${p.unsupported}`);
  if (!p.segments.length) throw new Error('The playlist has no video pieces');
  const { track, why } = await audioPlan(master, chosen, p, signal);

  // If any piece fails for good, `stop` makes the other workers quit instead of
  // quietly downloading the rest of a stream that is already doomed.
  const stop = new AbortController();
  const sig = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
  // Cookies are sent so streams on sites you are logged in to work, like they do in the page.
  const fetchOk = (u) => fetch(u, { signal: sig, credentials: 'include' });

  const keys = new Map(); // key url -> Promise<CryptoKey>, fetched once
  const getKey = (uri) => {
    if (!keys.has(uri)) {
      keys.set(
        uri,
        fetchOk(uri)
          .then((r) => {
            if (!r.ok) throw new Error(`Key HTTP ${r.status}`);
            return r.arrayBuffer();
          })
          .then((raw) => crypto.subtle.importKey('raw', raw, 'AES-CBC', false, ['decrypt'])),
      );
    }
    return keys.get(uri);
  };
  const fetchPiece = async (u, segment) => {
    let r;
    try {
      r = await fetchOk(u);
    } catch (e) {
      e.retry = !sig.aborted; // a network hiccup is worth another try, a stop is not
      throw e;
    }
    if (!r.ok) {
      const e = new Error(`Piece HTTP ${r.status}`);
      e.retry = r.status >= 500 || r.status === 429; // a 404 will still be a 404
      throw e;
    }
    const data = await r.arrayBuffer();
    if (!segment?.key) return data;
    // WebCrypto also strips the padding at the end.
    return crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivFor(segment) }, await getKey(segment.key.uri), data);
  };
  // A long download shouldn't die because one piece hiccuped: up to 3 tries, with a pause.
  const get = async (u, segment) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fetchPiece(u, segment);
      } catch (e) {
        if (!e.retry || attempt === 3) throw e;
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  };

  // 4 downloads at a time, results kept in playlist order. Progress counts the sound pieces too.
  const total = p.segments.length + (track?.segments.length || 0);
  let done = 0;
  let bytes = 0;
  const fetchParts = async (segments) => {
    const parts = new Array(segments.length);
    let next = 0;
    const worker = async () => {
      try {
        while (next < parts.length) {
          sig.throwIfAborted(); // stop between pieces even if fetch ignores the signal
          const i = next++;
          parts[i] = await get(segments[i].url, segments[i]);
          bytes += parts[i].byteLength;
          // The joined file is built in memory; stop with a clear message before the page runs out of it.
          if (bytes > maxBytes) throw new Error(`Too large to join in memory (over ${Math.round(maxBytes / 1e9 * 10) / 10} GB)`);
          onProgress(++done, total);
        }
      } catch (e) {
        stop.abort();
        throw e; // Promise.all below reports this first error, not the others' "aborted"
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return parts;
  };
  let parts = await fetchParts(p.segments);
  const soundParts = track ? await fetchParts(track.segments) : null;
  signal?.throwIfAborted(); // stopped while the last pieces were in flight: no file

  // Join the sound into the video. If that fails the video is still worth saving: say what is missing.
  let note = why ? `Saved without sound: ${why}` : '';
  if (soundParts) {
    try {
      parts = mergeTs(parts, soundParts);
    } catch (e) {
      note = `Saved without sound: ${e.message}`;
    }
  }

  const init = p.init ? [await get(p.init)] : [];
  // The type matters: without it Chrome calls the file plain text and renames it to .txt.
  // ponytail: the whole stream is held in memory, hence the maxBytes limit above.
  const ext = p.init ? 'mp4' : 'ts';
  return { blob: new Blob([...init, ...parts], { type: ext === 'mp4' ? 'video/mp4' : 'video/mp2t' }), ext, note };
}
