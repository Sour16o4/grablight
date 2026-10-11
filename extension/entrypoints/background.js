// The background script runs behind the scenes, separate from any web page.
// It does three things:
//  1. sniffs network responses for video/audio/streams the page never lists in its HTML,
//  2. checks every file's headers and gives it a light (see utils/light.js),
//  3. shows the page's overall light + file count on the toolbar icon.
import { scanPage } from '../utils/scan.js';
import { light, matchImage, matchVideo, pageLight, parseBlocked } from '../utils/light.js';
import { hlsInfo, pickQuality, MAX_BYTES } from '../utils/hls.js';
import { getSettings, addHistory } from '../utils/settings.js';

const SNIFF = /^(video|audio)\/|mpegurl|dash\+xml/i;
const BADGE_COLOR = { green: '#059669', yellow: '#d97706', red: '#dc2626' };

// tabId -> the page it shows, without the #fragment. Slow work (header checks) compares it before
// and after, so results for a page you already left are dropped instead of landing in the new list.
// Lost if this worker restarts: then the next navigation just clears the list, as before.
const pageOf = new Map();

// Files per tab live in storage.session: the service worker can be shut down at any time.
// Every read-then-write of a list goes through `locked`, one at a time: a page that requests
// several playlists at once would otherwise have its updates overwrite each other.
let listLock = Promise.resolve();
const locked = (fn) => {
  const run = listLock.then(fn, fn);
  listLock = run.catch(() => {});
  return run;
};
const key = (id) => `t${id}`;
const load = async (id) => (await browser.storage.session.get(key(id)))[key(id)] || {};
const save = (id, files) => browser.storage.session.set({ [key(id)]: files });

async function inspect(f) {
  if (f.status === undefined && f.kind === 'image' && !f.probe) {
    // ponytail: images are assumed fine (links to images are still checked: they can be web pages). Probing every image on every page you open would
    // mean hundreds of extra requests per page; a broken image just fails when downloaded.
    f.status = 200;
  } else if (f.status === undefined) {
    // sniffed files already came with headers; scanned ones need a HEAD request
    try {
      // credentials: cookies are sent, so files on sites you're logged in to are not wrongly red.
      const r = await fetch(f.url, { method: 'HEAD', signal: AbortSignal.timeout(5000), credentials: 'include' });
      // Many servers refuse HEAD but allow the real download (signed links often 403 on HEAD):
      // 401/403/405/501 here don't prove anything, so they count as "couldn't check" (yellow).
      f.status = [401, 403, 405, 501].includes(r.status) ? 0 : r.status;
      f.contentType = r.headers.get('content-type') || '';
      f.size = Number(r.headers.get('content-length')) || 0;
    } catch {
      f.status = 0;
    }
  }
  // Stream playlists: read them to learn if they use DRM or are live (DASH isn't supported).
  if (f.kind === 'manifest' && f.hlsChecked === undefined && f.ext !== 'mpd' && f.status < 400) {
    try {
      Object.assign(f, await hlsInfo(f.url));
    } catch {
      f.hlsChecked = false;
    }
  }
}

// Toolbar hover text, e.g. "Grablight: 3 images, 1 video, 1 file". Streams count as videos.
const NOUN = { image: 'image', video: 'video', manifest: 'video', audio: 'audio', file: 'file' };
function summary(list) {
  const n = {};
  list.forEach((f) => (n[NOUN[f.kind] || 'file'] = (n[NOUN[f.kind] || 'file'] || 0) + 1));
  const parts = Object.entries(n).map(([k, c]) => `${c} ${k}${c > 1 ? 's' : ''}`);
  return parts.length ? `Grablight: ${parts.join(', ')}` : 'Grablight: nothing found on this page';
}

async function finish(tabId, files) {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (!tab) return [];
  const list = Object.values(files);
  const extraBlocked = parseBlocked((await getSettings()).blockedSites);
  list.forEach((f) => (f.light = light(f, tab.url, extraBlocked)));
  await save(tabId, files);
  const color = list.length && pageLight(list);
  await browser.action.setBadgeText({ tabId, text: list.length ? String(Math.min(list.length, 99)) : '' });
  if (color) await browser.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR[color] });
  await browser.action.setTitle({ tabId, title: summary(list) });
  return list;
}

// Full pass: scan the page, merge with what the sniffer saw, check headers, set lights.
async function analyze(tabId) {
  const pageThen = pageOf.get(tabId);
  let scanned = [];
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: scanPage,
    });
    scanned = results.flatMap((r) => r.result || []);
  } catch {} // chrome:// pages etc. can't be scanned
  const files = await load(tabId);
  scanned.forEach((f) => (files[f.url] ||= f));
  const todo = Object.values(files);
  for (let i = 0; i < todo.length; i += 6) await Promise.all(todo.slice(i, i + 6).map(inspect));
  // A link that looks like a file (".webm") but turns out to be a web page is not a file: don't list it.
  for (const f of todo) if (f.probe && /text\/html/i.test(f.contentType || '')) delete files[f.url];
  if (pageOf.get(tabId) !== pageThen) return []; // navigated away meanwhile: this result is stale
  return locked(async () => {
    // The sniffer may have added files while we were checking headers: keep them.
    const current = await load(tabId);
    for (const f of Object.values(files)) current[f.url] = { ...current[f.url], ...f };
    return finish(tabId, current);
  });
}

async function videoInfo(tabId, src, image) {
  let files = Object.values(await load(tabId));
  if (!files.length) files = await analyze(tabId);
  return image ? matchImage(files, src) : matchVideo(files, src);
}

async function ensureOffscreen() {
  const open = await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (open.length) return;
  await browser.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS'],
    justification: 'Join the pieces of a video stream into one file',
  });
}

// ponytail: the offscreen page is never closed, so finished files stay in memory until the
// browser restarts. Close it once downloads.onChanged reports "complete" if that adds up.
// Stream downloads that are still fetching pieces. Normal downloads and finished streams are
// Chrome downloads, which the popup lists straight from the downloads API.
// Writes go through one queue so two progress updates can't overwrite each other.
let jobsQueue = Promise.resolve();
const setJob = (id, patch) =>
  (jobsQueue = jobsQueue.then(async () => {
    const { jobs = {} } = await browser.storage.session.get('jobs');
    if (patch) jobs[id] = { ...jobs[id], ...patch };
    else delete jobs[id];
    await browser.storage.session.set({ jobs });
  }));

// variantUrl: the stream quality picked in the popup. Otherwise the setting decides.
// Chrome download id -> the stream job whose joined file it is saving. When the download ends, the job's
// pieces on disk can go. ponytail: lost if this worker restarts; the offscreen page also clears old jobs itself.
const doneWith = new Map();

async function downloadFile(tabId, f, variantUrl) {
  let note = ''; // something the person should know about the file, e.g. it has no sound
  const tab = await browser.tabs.get(tabId).catch(() => null);
  let name = f.name;
  if (f.kind !== 'manifest') {
    await browser.downloads.download({ url: f.url });
  } else {
    const qualities = f.qualities || [];
    if (!variantUrl && qualities.length) {
      const { streamQuality } = await getSettings();
      const q = pickQuality(qualities, streamQuality === 'ask' ? 'best' : streamQuality);
      if (!q) throw new Error("Too large to join: every quality is over the size limit");
      variantUrl = q.url;
    }
    const label = qualities.find((q) => q.url === variantUrl)?.label;
    const title = ((tab?.title || f.name || 'video') + (label ? ` ${label}` : '')).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 90);
    const jobId = crypto.randomUUID();
    await setJob(jobId, { name: title, done: 0, total: 0 });
    try {
      await ensureOffscreen();
      const r = await browser.runtime.sendMessage({ type: 'hls-run', jobId, url: f.url, variantUrl, tabId });
      if (!r?.ok) throw new Error(r?.error || 'Download failed');
      name = `${title}.${r.ext}`;
      note = r.note || '';
      try {
        doneWith.set(await browser.downloads.download({ url: r.url, filename: name }), jobId);
      } catch (e) {
        browser.runtime.sendMessage({ type: 'hls-cleanup', jobId }).catch(() => {}); // never started: nothing will finish it
        throw e;
      }
    } finally {
      await setJob(jobId, null);
    }
  }
  await addHistory({ name, url: f.url, page: tab?.url || '', kind: f.kind, time: Date.now() });
  return note;
}

// This runs each time the background worker starts. A stream job still listed now belonged to a
// worker that was shut down, so nothing will ever finish it: stop it and clear its row.
async function dropOrphanJobs() {
  const { jobs = {} } = await browser.storage.session.get('jobs');
  await Promise.all(
    Object.keys(jobs).map((jobId) => browser.runtime.sendMessage({ type: 'hls-cancel', jobId }).catch(() => {})),
  );
  await browser.storage.session.remove('jobs');
}

// Re-colour every tab's files, e.g. after the blocked-sites setting changed.
async function refreshAllTabs() {
  for (const tab of await browser.tabs.query({})) {
    await locked(async () => {
      const files = await load(tab.id);
      if (Object.keys(files).length) await finish(tab.id, files);
    });
  }
}

export default defineBackground(() => {
  dropOrphanJobs();
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.blockedSites) refreshAllTabs();
  });
  browser.webRequest.onResponseStarted.addListener(
    async (d) => {
      if (d.tabId < 0) return;
      const h = (n) => d.responseHeaders?.find((x) => x.name.toLowerCase() === n)?.value || '';
      const type = h('content-type');
      const isManifest = /\.(m3u8|mpd)(\?|$)/i.test(d.url) || /mpegurl|dash\+xml/i.test(type);
      if (!SNIFF.test(type) && !isManifest) return;
      // The small pieces of a stream are not files you'd want one by one: the playlist covers them.
      // ponytail: fMP4 pieces served as video/mp4 with other extensions still slip through.
      if (!isManifest && (/mp2t/i.test(type) || /\.(ts|m4s)(\?|$)/i.test(d.url))) return;

      // Range requests for the same video differ only in these params: treat them as one file.
      const u = new URL(d.url);
      ['range', 'rn', 'rbuf'].forEach((p) => u.searchParams.delete(p));
      if ((await load(d.tabId))[u.href]) return;
      const raw = u.pathname.split('/').pop() || u.hostname;
      let name = raw;
      try {
        name = decodeURIComponent(raw);
      } catch {} // stray "%": keep the name as written
      const f = {
        url: u.href,
        name,
        ext: (name.match(/\.(\w+)$/) || [])[1]?.toLowerCase() || '',
        kind: isManifest ? 'manifest' : type.split('/')[0],
        // The player fetches in byte ranges (206); the file itself is whole and downloads fine.
        // Content-Range looks like "bytes 0-1023/789000": the number after "/" is the full size.
        status: d.statusCode === 206 ? 200 : d.statusCode,
        contentType: type,
        size: Number(h('content-range').split('/')[1]) || Number(h('content-length')) || 0,
      };
      const pageThen = pageOf.get(d.tabId);
      if (isManifest) await inspect(f); // network call, so reload the list afterwards
      if (pageOf.get(d.tabId) !== pageThen) return; // navigated away while checking
      await locked(async () => {
        const files = await load(d.tabId);
        files[u.href] ||= f;
        await finish(d.tabId, files);
      });
    },
    { urls: ['<all_urls>'] },
    ['responseHeaders'],
  );

  // New page (including single-page-app navigation) = start a fresh list.
  // A change that only touches the #fragment (a jump link, a hash route) is the same page: keep the list.
  browser.tabs.onUpdated.addListener(async (tabId, change) => {
    if (change.url) {
      const page = change.url.split('#')[0];
      if (pageOf.get(tabId) !== page) {
        pageOf.set(tabId, page);
        await locked(() => finish(tabId, {}));
      }
    }
    if (change.status === 'complete') {
      analyze(tabId);
      // Many pages fill in their file lists after loading (GitHub releases, infinite lists): look again twice.
      setTimeout(() => analyze(tabId), 3000);
      setTimeout(() => analyze(tabId), 10000);
    }
  });
  browser.downloads.onChanged.addListener((d) => {
    const jobId = doneWith.get(d.id);
    if (jobId && ['complete', 'interrupted'].includes(d.state?.current)) {
      doneWith.delete(d.id);
      browser.runtime.sendMessage({ type: 'hls-cleanup', jobId }).catch(() => {});
    }
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    pageOf.delete(tabId);
    browser.storage.session.remove(key(tabId));
  });

  // The popup and the on-page video button ask for things this way.
  browser.runtime.onMessage.addListener((msg, sender) => {
    if (msg?.type === 'analyze') return analyze(msg.tabId);
    if (msg?.type === 'video-info') return videoInfo(sender.tab.id, msg.src, msg.image);
    if (msg?.type === 'download') {
      const tabId = msg.tabId ?? sender.tab?.id;
      return downloadFile(tabId, msg.file, msg.variantUrl)
        .then(
          (note) => ({ ok: true, note }),
          (e) => ({ ok: false, error: e.message }),
        )
        .finally(() => locked(async () => finish(tabId, await load(tabId)))); // put the normal badge back
    }
    if (msg?.type === 'cancel-job') {
      return browser.runtime.sendMessage({ type: 'hls-cancel', jobId: msg.jobId }).catch(() => {});
    }
    // Stream progress: show it on the toolbar icon. It also keeps this worker awake.
    if (msg?.type === 'hls-progress') {
      const { tabId, done, total } = msg;
      setJob(msg.jobId, { done, total });
      browser.action.setBadgeText({ tabId, text: `${Math.floor((done / total) * 100)}%` });
      browser.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR.yellow });
    }
  });
});
