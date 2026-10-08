// Run: node utils/hls.test.js   (needs Node 20+ for global fetch/crypto/Blob)
import { createCipheriv } from 'node:crypto';
import assert from 'node:assert/strict';
import { parsePlaylist, ivFor, downloadHls, hlsInfo } from './hls.js';

const B = 'https://cdn.test/v/';

// --- parsing ---
const master = parsePlaylist(
  '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,CODECS="avc1,mp4a"\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\nhigh.m3u8\n',
  B,
);
assert.deepEqual(master.variants.map((v) => v.url), [B + 'low.m3u8', B + 'high.m3u8']);

const drm = parsePlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x"\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST', B);
assert.equal(drm.drm, true);
assert.equal(parsePlaylist('#EXTM3U\n#EXTINF:4,\na.ts\n', B).live, true);
assert.equal(parsePlaylist('#EXTM3U\n#EXT-X-BYTERANGE:100@0\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST', B).unsupported, 'byte-range playlists');
assert.throws(() => parsePlaylist('<html>', B), /Not an HLS/);

// IV: explicit hex, or the sequence number (big-endian) when absent
assert.equal(ivFor({ key: { iv: '0x01' }, seq: 9 })[15], 1);
assert.equal(ivFor({ key: {}, seq: 258 }).slice(14).join(), '1,2');

// --- full download of a fake encrypted stream: master -> media -> 3 AES-128 pieces ---
const key = Buffer.alloc(16, 7);
const plain = ['first piece ', 'second piece ', 'third piece'].map((s) => Buffer.from(s.repeat(20)));
const seqStart = 5;
const encrypted = plain.map((p, i) => {
  const iv = Buffer.from(ivFor({ key: {}, seq: seqStart + i })); // playlist has no IV: seq is used
  const c = createCipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([c.update(p), c.final()]);
});
const files = {
  [B + 'master.m3u8']: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=900\nhigh.m3u8\n',
  [B + 'high.m3u8']: `#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:${seqStart}\n#EXT-X-KEY:METHOD=AES-128,URI="k.key"\n${[0, 1, 2].map((i) => `#EXTINF:4,\ns${i}.ts`).join('\n')}\n#EXT-X-ENDLIST\n`,
  [B + 'k.key']: key,
  ...Object.fromEntries(encrypted.map((e, i) => [B + `s${i}.ts`, e])),
};
globalThis.fetch = async (u) =>
  u in files
    ? new Response(files[u], { status: 200 })
    : new Response('nope', { status: 404 });

const progress = [];
const { blob, ext } = await downloadHls(B + 'master.m3u8', (d, t) => progress.push(`${d}/${t}`));
assert.equal(ext, 'ts');
assert.equal(blob.type, 'video/mp2t');
assert.equal(Buffer.from(await blob.arrayBuffer()).toString(), Buffer.concat(plain).toString());
assert.equal(progress.at(-1), '3/3');
assert.deepEqual(await hlsInfo(B + 'master.m3u8'), { hlsChecked: true, drm: false, live: false, unsupported: '' });

// stopping mid-download rejects and stops fetching more pieces
{
  const ctl = new AbortController();
  let pieces = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (u, o) => (u.endsWith('.ts') && pieces++, realFetch(u, o));
  await assert.rejects(downloadHls(B + 'master.m3u8', () => ctl.abort(), ctl.signal), /abort/i);
  assert.ok(pieces < 3 * 2, 'kept fetching after stop');
  globalThis.fetch = realFetch;
}

// one failed piece (503) is retried and the download still completes
{
  let fails = 1;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (u, o) => (u.endsWith('s1.ts') && fails-- > 0 ? new Response('busy', { status: 503 }) : realFetch(u, o));
  const out = await downloadHls(B + 'master.m3u8');
  assert.equal(Buffer.from(await out.blob.arrayBuffer()).toString(), Buffer.concat(plain).toString());
  globalThis.fetch = realFetch;
}

// when a piece fails for good, the other workers stop instead of downloading the rest
{
  const many = 40;
  const big = { ...files, [B + 'high.m3u8']: `#EXTM3U\n#EXTINF:4,\ns0.ts\n${Array.from({ length: many - 1 }, (_, i) => `#EXTINF:4,\nx${i}.ts`).join('\n')}\n#EXT-X-ENDLIST\n` };
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async (u, o) => {
    if (u.endsWith('.ts')) fetched++;
    if (u.endsWith('s0.ts')) return new Response('gone', { status: 404 }); // s0 fails at once
    if (u.includes('/x')) {
      await new Promise((r) => setTimeout(r, 20));
      return new Response('data', { status: 200 });
    }
    return u in big ? new Response(big[u], { status: 200 }) : realFetch(u, o);
  };
  await assert.rejects(downloadHls(B + 'master.m3u8'), /Piece HTTP 404/);
  await new Promise((r) => setTimeout(r, 300)); // give stray workers time to misbehave
  assert.ok(fetched < many / 2, `kept fetching after failure: ${fetched} of ${many}`);
  globalThis.fetch = realFetch;
}

// a stream bigger than the memory limit fails with a clear message, not a crash
await assert.rejects(downloadHls(B + 'master.m3u8', () => {}, undefined, 100), /Too large to join in memory/);

// a missing piece fails loudly instead of giving a short file
delete files[B + 's1.ts'];
await assert.rejects(downloadHls(B + 'master.m3u8'), /Piece HTTP 404/);

console.log('hls.js checks done');
