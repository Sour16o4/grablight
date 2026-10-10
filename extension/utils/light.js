// Decides a file's light: green = will download, yellow = may fail, red = can't.
// Pure function (no browser APIs) so it can be checked with plain node.

// Sites whose video/audio we refuse to download (DRM or terms of service).
// Edit this list to change which sites are blocked.
export const BLOCKED =
  /(^|\.)((netflix|primevideo|disneyplus|hotstar|spotify|youtube|googlevideo)\.com|youtu\.be)$/i;

const MEDIA_KINDS = ['video', 'audio', 'manifest'];
const hostOf = (u) => {
  try {
    return new URL(u).hostname;
  } catch {
    return '';
  }
};

// The settings page stores extra blocked sites as free text: "example.com, other.org" or one per line.
export const parseBlocked = (text = '') =>
  text
    .toLowerCase()
    .split(/[\s,]+/)
    .map((s) => s.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
    .filter(Boolean);

// f: { url, kind, status, contentType }. status is 0 when we couldn't check it.
// extraBlocked: sites the user added in settings (a site blocks itself and its subdomains).
export function light(f, pageUrl = '', extraBlocked = []) {
  const red = (reason) => ({ color: 'red', reason });
  const yellow = (reason) => ({ color: 'yellow', reason });
  const blocked = (host) => BLOCKED.test(host) || extraBlocked.some((s) => host === s || host.endsWith(`.${s}`));

  if (MEDIA_KINDS.includes(f.kind) && (blocked(hostOf(pageUrl)) || blocked(hostOf(f.url)))) {
    return red("This site doesn't allow downloads");
  }
  if (f.status >= 400) {
    return red(
      f.status === 401 || f.status === 403
        ? `Needs a login or is blocked (HTTP ${f.status})`
        : `Server error (HTTP ${f.status})`,
    );
  }
  if (f.kind === 'manifest') {
    if (f.ext === 'mpd' || /dash\+xml/i.test(f.contentType || '')) return red("DASH streams aren't supported yet");
    if (f.drm) return red('Protected by DRM, cannot be downloaded');
    if (f.live) return red("Live streams can't be downloaded");
    if (f.unsupported) return red(`Not supported yet: ${f.unsupported}`);
    if (!f.hlsChecked) return yellow("Couldn't read the playlist");
    return { color: 'green', reason: 'Video stream: pieces are joined into one file' };
  }
  if (/text\/html/i.test(f.contentType || '')) return red('This is a web page, not a file');
  if (!f.status) return yellow("Couldn't check this file");
  return { color: 'green', reason: 'Should download' };
}

// One light for the whole page: best color wins, so green means "something works here".
export function pageLight(files) {
  const colors = files.map((f) => f.light.color);
  return ['green', 'yellow', 'red'].find((c) => colors.includes(c));
}

// Which file belongs to a <video>? Only an exact src match (ignoring #fragment) is certain.
// A blob: video with a single candidate on the page is also safe. Anything else is a guess:
// still returned so it can be downloaded, but yellow, so the light never claims more than we know.
export function matchVideo(files, src = '') {
  const videos = files.filter((f) => (f.kind === 'video' || f.kind === 'manifest') && f.light);
  const bare = (u) => u.split('#')[0];
  const exact = videos.find((f) => bare(f.url) === bare(src));
  if (exact) return exact;
  const ok = videos.filter((f) => f.light.color !== 'red');
  if (src.startsWith('blob:') && videos.length === 1) return videos[0];
  const guess = ok.find((f) => f.kind === 'manifest') || [...ok].sort((a, b) => b.size - a.size)[0] || videos[0];
  if (!guess) return null;
  if (guess.light.color === 'red') return guess; // nothing on the page works, so red is true for every candidate
  return { ...guess, light: { color: 'yellow', reason: "Couldn't tell which file this video uses; this is the best match on the page" } };
}

// An <img> only ever matches its own file: there is no "best image on the page" to fall back to.
export const matchImage = (files, src = '') => files.find((f) => f.kind === 'image' && f.light && f.url.split('#')[0] === src.split('#')[0]) || null;
