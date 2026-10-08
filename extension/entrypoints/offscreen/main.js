// A hidden page the background script opens to join HLS pieces into one file.
// The background script can't do this itself: a service worker has no URL.createObjectURL,
// and building a multi-hundred-MB file as a data: URL would not work.
import { downloadHls } from '../../utils/hls.js';

const running = new Map(); // jobId -> AbortController, so a job can be stopped

browser.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'hls-cancel') {
    running.get(msg.jobId)?.abort();
    reply(true);
    return;
  }
  if (msg?.type !== 'hls-run') return;

  const ctl = new AbortController();
  running.set(msg.jobId, ctl);
  downloadHls(
    msg.url,
    (done, total) => browser.runtime.sendMessage({ type: 'hls-progress', jobId: msg.jobId, tabId: msg.tabId, done, total }),
    ctl.signal,
  )
    .then(({ blob, ext }) => reply({ ok: true, url: URL.createObjectURL(blob), ext }))
    .catch((e) => reply({ ok: false, error: ctl.signal.aborted ? 'Stopped' : e.message }))
    .finally(() => running.delete(msg.jobId));
  return true; // we answer later
});
