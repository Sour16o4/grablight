// Run: node utils/hls.test.js   (needs Node 20+ for global fetch/crypto/Blob)
import { createCipheriv } from 'node:crypto';
import assert from 'node:assert/strict';
import { parsePlaylist, ivFor, downloadHls, hlsInfo, qualitiesOf, pickQuality, loadMedia } from './hls.js';

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
{
  const info = await hlsInfo(B + 'master.m3u8');
  assert.deepEqual({ ...info, qualities: undefined }, { hlsChecked: true, drm: false, live: false, unsupported: '', qualities: undefined });
  assert.equal(info.qualities.length, 2); // low and high, best first
}

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

// ---------- stream qualities ----------
const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=9000000,AVERAGE-BANDWIDTH=8000000,RESOLUTION=3840x2160,CODECS="avc1.640033,mp4a.40.2"
huge.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
hd.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
mid.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=64000,CODECS="mp4a.40.2"
audio.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080
hd.m3u8
`;
const parsedMaster = parsePlaylist(MASTER, B);
assert.equal(parsedMaster.variants[0].bandwidth, 8000000, 'average bitrate is preferred');
assert.deepEqual(parsedMaster.variants[1].resolution, [1920, 1080]);

// 1 hour long: each quality's size is bitrate x length
const hour = { variants: parsedMaster.variants, duration: 3600 };
const qs = qualitiesOf(hour);
assert.deepEqual(qs.map((q) => q.label), ['2160p (4K)', '1080p', '720p', 'Audio only'], 'best first, duplicates removed');
assert.equal(qs[1].est, 3000000 / 8 * 3600);
assert.deepEqual(qs.map((q) => q.tooBig), [true, false, false, false], '4K (3.6 GB) is over the 1.5 GB limit');
assert.equal(qs[3].audioOnly, true);
assert.equal(qualitiesOf({ variants: [{ url: 'u', bandwidth: 2500000, resolution: null, codecs: '' }], duration: 10 })[0].label, '2.5 Mbps');

// choosing: never too big, video over audio-only, "at most N" or the smallest there is
assert.equal(pickQuality(qs, 'best').label, '1080p', 'best that fits, skipping the too-big 4K');
assert.equal(pickQuality(qs, 720).label, '720p');
assert.equal(pickQuality(qs, '480').label, '720p', 'nothing at or under 480p: the smallest video');
assert.equal(pickQuality(qs.map((q) => ({ ...q, tooBig: true }))), null, 'nothing fits');
assert.equal(pickQuality(qs.filter((q) => q.audioOnly), 'best').label, 'Audio only', 'audio only if that is all there is');

// a broken best quality falls through to the next one
{
  const f = {
    [B + 'm.m3u8']: MASTER.replace(/huge/, 'huge').replace(/^#EXT-X-STREAM-INF:BANDWIDTH=64000.*\n.*\n/m, ''),
    [B + 'hd.m3u8']: '#EXTM3U\n#EXTINF:10,\nhd0.ts\n#EXTINF:10,\nhd1.ts\n#EXT-X-ENDLIST\n',
    [B + 'mid.m3u8']: '#EXTM3U\n#EXTINF:10,\nmid0.ts\n#EXT-X-ENDLIST\n',
    [B + 'hd0.ts']: Buffer.from('HD0-'), [B + 'hd1.ts']: Buffer.from('HD1-'), [B + 'mid0.ts']: Buffer.from('MID0-'),
  }; // huge.m3u8 is missing: 404
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => (u in f ? new Response(f[u], { status: 200 }) : new Response('x', { status: 404 }));
  const media = await loadMedia(B + 'm.m3u8');
  assert.ok(media.url.endsWith('hd.m3u8'), 'skipped the broken 4K and used 1080p');
  assert.equal(media.duration, 20);
  assert.equal(media.variants.length, 4, 'the master list is kept for the picker');

  const text = async (r) => Buffer.from(await r.blob.arrayBuffer()).toString();
  assert.equal(await text(await downloadHls(B + 'm.m3u8')), 'HD0-HD1-', 'no choice: best quality that fits');
  assert.equal(await text(await downloadHls(B + 'm.m3u8', () => {}, undefined, undefined, B + 'mid.m3u8')), 'MID0-', 'the chosen quality is the one downloaded');
  // a tiny memory limit rules 1080p out (1080p is 3 Mbps x 20 s = 7.5 MB; 720p is 3.75 MB): falls back to 720p
  assert.equal(await text(await downloadHls(B + 'm.m3u8', () => {}, undefined, 5e6)), 'MID0-', 'too big for memory: the next quality down');
  await assert.rejects(downloadHls(B + 'm.m3u8', () => {}, undefined, 1), /Too large to join in memory/);
  globalThis.fetch = realFetch;
}

console.log('hls.js checks done');
