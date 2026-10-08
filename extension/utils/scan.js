// Phase 2: finds downloadable files on a page.
// scanPage runs INSIDE the web page (injected by the popup), so it must be
// self-contained: no imports, no references to anything outside the function.
export function scanPage() {
  const FILE_EXT =
    /\.(pdf|zip|rar|7z|tar|gz|docx?|xlsx?|pptx?|csv|txt|epub|apk|exe|dmg|iso|mp3|wav|ogg|m4a|mp4|webm|mkv|mov|jpe?g|png|gif|webp|avif|svg)$/i;
  const KINDS = {
    video: /^(mp4|webm|mkv|mov)$/,
    audio: /^(mp3|wav|ogg|m4a)$/,
    image: /^(jpe?g|png|gif|webp|avif|svg)$/,
  };

  const found = new Map(); // url -> file, so duplicates collapse
  const add = (src, kind) => {
    if (!src) return;
    let url;
    try {
      url = new URL(src, location.href);
    } catch {
      return;
    }
    if (!/^https?:$/.test(url.protocol) || found.has(url.href)) return;
    const raw = url.pathname.split('/').pop() || url.hostname;
    let name = raw;
    try {
      name = decodeURIComponent(raw);
    } catch {} // a stray "%" in the URL: keep it as written instead of failing the whole scan
    const ext = (name.match(/\.(\w+)$/) || [])[1]?.toLowerCase() || '';
    if (!kind) kind = Object.keys(KINDS).find((k) => KINDS[k].test(ext)) || 'file';
    if (/^(m3u8|mpd)$/.test(ext)) kind = 'manifest'; // a stream playlist, not a video file
    found.set(url.href, { url: url.href, name, ext, kind });
  };

  // Links only count when they point at a known file type.
  document.querySelectorAll('a[href]').forEach((a) => {
    try {
      if (FILE_EXT.test(new URL(a.href).pathname)) add(a.href);
    } catch {}
  });
  // Media elements are files by definition.
  document.querySelectorAll('img[src]').forEach((e) => add(e.currentSrc || e.src, 'image'));
  document.querySelectorAll('video').forEach((e) => add(e.currentSrc || e.src, 'video'));
  document.querySelectorAll('audio').forEach((e) => add(e.currentSrc || e.src, 'audio'));
  document.querySelectorAll('video source[src], audio source[src]').forEach((e) =>
    add(e.src, e.closest('audio') ? 'audio' : 'video'),
  );

  // --- Phase 7: things the plain scan above misses ---

  // Tags many sites add so link previews work: they often name the real video or audio file.
  document
    .querySelectorAll(
      'meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"], meta[name="twitter:player:stream"]',
    )
    .forEach((m) => add(m.content, 'video'));
  document
    .querySelectorAll('meta[property="og:audio"], meta[property="og:audio:url"]')
    .forEach((m) => add(m.content, 'audio'));
  document.querySelectorAll('meta[property="og:image"]').forEach((m) => add(m.content, 'image'));

  // Structured data ("JSON-LD"): VideoObject / AudioObject carry a contentUrl.
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const type = [].concat(node['@type'] || []).join(' ');
    if (node.contentUrl && /VideoObject|AudioObject/.test(type)) {
      add(node.contentUrl, /Audio/.test(type) ? 'audio' : 'video');
    }
    Object.values(node).forEach(walk);
  };
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try {
      walk(JSON.parse(s.textContent));
    } catch {} // invalid JSON on the page: skip it
  });

  // Lazy-loaded media keeps its real URL in a data-* attribute until you scroll to it.
  document
    .querySelectorAll('img[data-src], img[data-original], img[data-lazy-src], source[data-src], video[data-src]')
    .forEach((e) => {
      const src = e.dataset.src || e.dataset.original || e.dataset.lazySrc;
      add(src, e.tagName === 'VIDEO' || e.closest('video') ? 'video' : e.closest('audio') ? 'audio' : 'image');
    });

  // srcset lists one image at several sizes ("a.jpg 480w, b.jpg 1200w"): take the biggest.
  document.querySelectorAll('img[srcset], source[srcset]').forEach((e) => {
    const best = e
      .getAttribute('srcset')
      .split(',')
      .map((s) => s.trim().split(/\s+/))
      .sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]))[0];
    if (best?.[0] && (e.tagName === 'IMG' || !e.closest('video, audio'))) add(best[0], 'image');
  });

  // A link marked download is a file whatever its URL looks like.
  document.querySelectorAll('a[download][href]').forEach((a) => add(a.href));

  // Site adapters: add one object per site that needs its own rule.
  const ADAPTERS = [
    {
      // Wikipedia / Wikimedia Commons: the file page links the original upload.
      host: /(^|\.)(wikipedia|wikimedia)\.org$/,
      run: () => document.querySelectorAll('.fullMedia a[href]').forEach((a) => add(a.href)),
    },
    {
      // GitHub: release downloads often have no file extension (e.g. a bare Linux binary).
      host: /(^|\.)github\.com$/,
      run: () => document.querySelectorAll('a[href*="/releases/download/"]').forEach((a) => add(a.href, 'file')),
    },
  ];
  ADAPTERS.filter((a) => a.host.test(location.hostname)).forEach((a) => a.run());

  return [...found.values()];
}
