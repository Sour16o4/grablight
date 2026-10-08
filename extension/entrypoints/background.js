// The background script runs behind the scenes, separate from any web page.
// It does three things:
//  1. sniffs network responses for video/audio/streams the page never lists in its HTML,
//  2. checks every file's headers and gives it a light (see utils/light.js),
//  3. shows the page's overall light + file count on the toolbar icon.
import { scanPage } from '../utils/scan.js';
import { light, pageLight, parseBlocked } from '../utils/light.js';
import { hlsInfo } from '../utils/hls.js';
import { getSettings, addHistory } from '../utils/settings.js';

const SNIFF = /^(video|audio)\/|mpegurl|dash\+xml/i;
const BADGE_COLOR = { green: '#059669', yellow: '#d97706', red: '#dc2626' };

// tabId -> the page it shows, without the #fragment. Slow work (header checks) compares it before
// and after, so results for a page you already left are dropped instead of landing in the new list.
// Lost if this worker restarts: then the next navigation just clears the list, as before.
const pageOf = new Map();

// Files per tab live in storage.session: the service worker can be shut down at any time.
// ponytail: read-modify-write without a lock; two requests landing in the same instant
// can drop one. Fine for a list that is rebuilt on every analyze.
const key = (id) => `t${id}`;
const load = async (id) => (await browser.storage.session.get(key(id)))[key(id)] || {};
const save = (id, files) => browser.storage.session.set({ [key(id)]: files });

async function inspect(f) {
  if (f.status === undefined && f.kind === 'image') {
    // ponytail: images are assumed fine. Probing every image on every page you open would
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
  if (pageOf.get(tabId) !== pageThen) return []; // navigated away meanwhile: this result is stale
  return finish(tabId, files);
}

// Which file belongs to a <video>? Exact match on its src if the page gave a real URL;
// otherwise (blob: streams) a working stream playlist, else the biggest working video the
// sniffer saw: working beats broken.
async function videoInfo(tabId, src) {
  let files = Object.values(await load(tabId));
  if (!files.length) files = await analyze(tabId);
  const videos = files.filter((f) => (f.kind === 'video' || f.kind === 'manifest') && f.light);
  const ok = videos.filter((f) => f.light.color !== 'red');
  return (
    videos.find((f) => f.url === src) ||
    ok.find((f) => f.kind === 'manifest') ||
    ok.sort((a, b) => b.size - a.size)[0] ||
    videos[0] ||
    null
  );
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

async function downloadFile(tabId, f) {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  let name = f.name;
  if (f.kind !== 'manifest') {
    await browser.downloads.download({ url: f.url });
  } else {
    const title = (tab?.title || f.name || 'video').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80);
    const jobId = crypto.randomUUID();
    await setJob(jobId, { name: title, done: 0, total: 0 });
    try {
      await ensureOffscreen();
      const r = await browser.runtime.sendMessage({ type: 'hls-run', jobId, url: f.url, tabId });
      if (!r?.ok) throw new Error(r?.error || 'Download failed');
      name = `${title}.${r.ext}`;
      await browser.downloads.download({ url: r.url, filename: name });
    } finally {
      await setJob(jobId, null);
    }
  }
  await addHistory({ name, url: f.url, page: tab?.url || '', kind: f.kind, time: Date.now() });
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
    const files = await load(tab.id);
    if (Object.keys(files).length) await finish(tab.id, files);
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
      const files = await load(d.tabId);
      files[u.href] ||= f;
      await finish(d.tabId, files);
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
        await finish(tabId, {});
      }
    }
    if (change.status === 'complete') analyze(tabId);
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    pageOf.delete(tabId);
    browser.storage.session.remove(key(tabId));
  });

  // The popup and the on-page video button ask for things this way.
  browser.runtime.onMessage.addListener((msg, sender) => {
    if (msg?.type === 'analyze') return analyze(msg.tabId);
    if (msg?.type === 'video-info') return videoInfo(sender.tab.id, msg.src);
    if (msg?.type === 'download') {
      const tabId = msg.tabId ?? sender.tab?.id;
      return downloadFile(tabId, msg.file)
        .then(
          () => ({ ok: true }),
          (e) => ({ ok: false, error: e.message }),
        )
        .finally(async () => finish(tabId, await load(tabId))); // put the normal badge back
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
