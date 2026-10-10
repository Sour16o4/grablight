// A hidden page the background script opens to join HLS pieces into one file.
// The background script can't do this itself: a service worker has no URL.createObjectURL,
// and building a multi-hundred-MB file as a data: URL would not work.
// Pieces wait in the browser's private disk storage (OPFS), not in memory, so a stream can be bigger than memory.
import { downloadHls, diskLimit, memoryStore, MAX_BYTES } from '../../utils/hls.js';

const running = new Map(); // jobId -> AbortController, so a job can be stopped
const finished = new Map(); // jobId -> { url, name }: a file waiting for Chrome to finish downloading it

const root = () => navigator.storage.getDirectory();
const DAY = 24 * 3600 * 1000;

// Forget a job's pieces and its blob url.
async function cleanup(jobId) {
  const f = finished.get(jobId);
  finished.delete(jobId);
  if (f?.url) URL.revokeObjectURL(f.url);
  if (f?.name) await (await root()).removeEntry(f.name, { recursive: true }).catch(() => {});
}

// Leftovers of jobs from an earlier session (the browser was closed mid-download, or the cleanup message was lost).
async function purgeOld() {
  const dir = await root();
  const keep = new Set([...finished.values()].map((f) => f.name));
  for await (const name of dir.keys()) {
    const born = Number(name.split('-')[1]);
    if (name.startsWith('job-') && !keep.has(name) && !(Date.now() - born < DAY && [...running.keys()].some((id) => name.endsWith(id)))) {
      await dir.removeEntry(name, { recursive: true }).catch(() => {});
    }
  }
}

// Pieces as files in one folder per job. Returns null where disk storage isn't available.
async function diskStore(name) {
  try {
    const dir = await (await root()).getDirectoryHandle(name, { create: true });
    let n = 0;
    return {
      where: 'on disk',
      async put(bytes) {
        const file = `p${n++}`;
        const w = await (await dir.getFileHandle(file, { create: true })).createWritable();
        await w.write(bytes);
        await w.close();
        return file;
      },
      get: async (file) => (await (await dir.getFileHandle(file)).getFile()).arrayBuffer(),
      // A Blob made of files stays on disk: it is read piece by piece when Chrome saves it.
      blob: async (files, type) => new Blob(await Promise.all(files.map(async (f) => (await dir.getFileHandle(f)).getFile())), { type }),
    };
  } catch {
    return null;
  }
}

browser.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'hls-cancel') {
    running.get(msg.jobId)?.abort();
    reply(true);
    return;
  }
  if (msg?.type === 'hls-cleanup') {
    cleanup(msg.jobId).then(() => reply(true));
    return true;
  }
  if (msg?.type !== 'hls-run') return;

  const ctl = new AbortController();
  running.set(msg.jobId, ctl);
  const name = `job-${Date.now()}-${msg.jobId}`;
  (async () => {
    await purgeOld();
    const disk = await diskStore(name);
    const { blob, ext, note } = await downloadHls(
      msg.url,
      (done, total) => browser.runtime.sendMessage({ type: 'hls-progress', jobId: msg.jobId, tabId: msg.tabId, done, total }),
      ctl.signal,
      disk ? await diskLimit() : MAX_BYTES,
      msg.variantUrl,
      disk || memoryStore,
    );
    const url = URL.createObjectURL(blob);
    finished.set(msg.jobId, { url, name: disk ? name : null });
    return { ok: true, url, ext, note };
  })()
    .catch(async (e) => {
      await (await root()).removeEntry(name, { recursive: true }).catch(() => {}); // stopped or failed: nothing to keep
      return { ok: false, error: ctl.signal.aborted ? 'Stopped' : e.message };
    })
    .then(reply)
    .finally(() => running.delete(msg.jobId));
  return true; // we answer later
});
