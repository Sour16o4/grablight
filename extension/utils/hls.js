// Phase 6: HLS (.m3u8) streams. A stream is a playlist listing many small video pieces
// ("segments"). We read the playlist, fetch every piece (decrypting AES-128 ones),
// and join them into one file. Pure JS (fetch + WebCrypto only), so it runs in the
// offscreen page in Chrome and in plain node for the checks in hls.test.js.
//
// Not supported, reported as such instead of producing a broken file:
//   DRM (SAMPLE-AES, Widevine, FairPlay), live streams, byte-range playlists.
// ponytail: output is the raw joined pieces (.ts, or .mp4 for fMP4 streams), no remuxing;
// players like VLC and mpv open it, upgrade to a remuxer if people need a clean .mp4.
// ponytail: master playlists with separate audio tracks give video only (best-quality variant).

const attrs = (s) =>
  Object.fromEntries(
    [...s.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)].map((m) => [m[1], m[2].replace(/^"|"$/g, '')]),
  );

export function parsePlaylist(text, base) {
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines[0] !== '#EXTM3U') throw new Error('Not an HLS playlist');
  const abs = (u) => new URL(u, base).href;
  const out = { variants: [], segments: [], init: null, drm: false, live: true, unsupported: '' };
  let seq = 0;
  let key = null;
  let bandwidth = null; // set by STREAM-INF, consumed by the URI line after it
  let segment = false; // set by EXTINF, consumed by the URI line after it

  for (const line of lines) {
    if (line.startsWith('#EXT-X-STREAM-INF:')) bandwidth = Number(attrs(line.slice(18)).BANDWIDTH) || 0;
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
    else if (line.startsWith('#EXTINF:')) segment = true;
    else if (!line.startsWith('#')) {
      if (bandwidth !== null) {
        out.variants.push({ url: abs(line), bandwidth });
        bandwidth = null;
      } else if (segment) {
        out.segments.push({ url: abs(line), key, seq: seq++ });
        segment = false;
      }
    }
  }
  return out;
}

// Fetches a playlist; if it is a master playlist, follows the best-quality variant.
export async function loadMedia(url, signal) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { signal, credentials: 'include' });
    if (!r.ok) throw new Error(`Playlist HTTP ${r.status}`);
    const p = parsePlaylist(await r.text(), r.url || url);
    if (!p.variants.length) return p;
    url = p.variants.sort((a, b) => b.bandwidth - a.bandwidth)[0].url;
  }
  throw new Error('Playlist nesting too deep');
}

// What the light needs to know about a stream, without downloading it.
export async function hlsInfo(url) {
  const { drm, live, unsupported } = await loadMedia(url);
  return { hlsChecked: true, drm, live, unsupported };
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
export async function downloadHls(url, onProgress = () => {}, signal, maxBytes = 1.5e9) {
  const p = await loadMedia(url, signal);
  if (p.drm) throw new Error('Protected by DRM, cannot be downloaded');
  if (p.live) throw new Error("Live streams can't be downloaded");
  if (p.unsupported) throw new Error(`Not supported yet: ${p.unsupported}`);
  if (!p.segments.length) throw new Error('The playlist has no video pieces');

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

  // 4 downloads at a time, results kept in playlist order.
  const parts = new Array(p.segments.length);
  let next = 0;
  let done = 0;
  let bytes = 0;
  const worker = async () => {
    try {
      while (next < parts.length) {
        sig.throwIfAborted(); // stop between pieces even if fetch ignores the signal
        const i = next++;
        parts[i] = await get(p.segments[i].url, p.segments[i]);
        bytes += parts[i].byteLength;
        // The joined file is built in memory; stop with a clear message before the page runs out of it.
        if (bytes > maxBytes) throw new Error(`Too large to join in memory (over ${Math.round(maxBytes / 1e9 * 10) / 10} GB)`);
        onProgress(++done, parts.length);
      }
    } catch (e) {
      stop.abort();
      throw e; // Promise.all below reports this first error, not the others' "aborted"
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  signal?.throwIfAborted(); // stopped while the last pieces were in flight: no file

  const init = p.init ? [await get(p.init)] : [];
  // The type matters: without it Chrome calls the file plain text and renames it to .txt.
  // ponytail: the whole stream is held in memory, hence the maxBytes limit above.
  const ext = p.init ? 'mp4' : 'ts';
  return { blob: new Blob([...init, ...parts], { type: ext === 'mp4' ? 'video/mp4' : 'video/mp2t' }), ext };
}
