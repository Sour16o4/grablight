// Run: node utils/scan.test.js
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { scanPage } from './scan.js';

// Runs scanPage against a fake page at `url` and returns { url -> kind }.
function scan(url, html) {
  const { window } = new JSDOM(html, { url });
  globalThis.document = window.document;
  globalThis.location = window.location;
  return Object.fromEntries(scanPage().map((f) => [f.url, f.kind]));
}

// Plain scan: file links by extension, media elements, duplicates merged.
let r = scan(
  'https://site.test/page',
  `<a href="/a.pdf">a</a><a href="/about">about</a><a href="/a.pdf">again</a>
   <img src="/pic.png"><video src="/v.mp4"></video><a href="/x.m3u8" download>stream</a>`,
);
assert.deepEqual(r, {
  'https://site.test/a.pdf': 'file',
  'https://site.test/pic.png': 'image',
  'https://site.test/v.mp4': 'video',
  'https://site.test/x.m3u8': 'manifest',
});

// Phase 7 generic extras
r = scan(
  'https://news.test/story',
  `<meta property="og:video" content="https://cdn.test/clip.mp4">
   <meta property="og:image" content="https://cdn.test/cover.jpg">
   <script type="application/ld+json">{"@graph":[{"@type":"VideoObject","contentUrl":"https://cdn.test/ld.webm"}]}</script>
   <script type="application/ld+json">{ not json</script>
   <img data-src="/lazy.jpg" src="data:image/gif;base64,R0lGOD">
   <img srcset="/s.jpg 480w, /l.jpg 1200w, /m.jpg 800w">
   <a download href="/export?id=7">export</a>`,
);
assert.equal(r['https://cdn.test/clip.mp4'], 'video');
assert.equal(r['https://cdn.test/cover.jpg'], 'image');
assert.equal(r['https://cdn.test/ld.webm'], 'video');
assert.equal(r['https://news.test/lazy.jpg'], 'image');
assert.equal(r['https://news.test/l.jpg'], 'image'); // biggest of the srcset
assert.equal(r['https://news.test/s.jpg'], undefined);
assert.equal(r['https://news.test/export?id=7'], 'file');

// One link with a broken "%" must not wipe out the whole scan
r = scan('https://site.test/', '<a href="/100%.pdf">bad</a><a href="/fine.pdf">ok</a>');
assert.equal(r['https://site.test/fine.pdf'], 'file');
assert.equal(r['https://site.test/100%.pdf'], 'file');

// Site adapters only run on their own site
const gh = '<a href="/o/r/releases/download/v1/tool-linux">bin</a>';
assert.equal(scan('https://github.com/o/r/releases', gh)['https://github.com/o/r/releases/download/v1/tool-linux'], 'file');
assert.deepEqual(scan('https://other.test/', gh), {});
assert.equal(
  scan('https://commons.wikimedia.org/wiki/File:X.jpg', '<div class="fullMedia"><a href="https://upload.wikimedia.org/x/X.jpg">o</a></div>')[
    'https://upload.wikimedia.org/x/X.jpg'
  ],
  'image',
);

console.log('scan.js checks done');
