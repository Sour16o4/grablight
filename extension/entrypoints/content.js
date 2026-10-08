// Phase 5: a small button that appears over any video you hover, with its light.
// It runs inside the web page; the background script does the real work
// (finding the file, downloading), because only it can use the downloads API.
const COLORS = { green: '#10b981', yellow: '#f59e0b', red: '#ef4444' };
const LABELS = { green: 'Download', yellow: 'Download (may fail)', red: "Can't download" };

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true, // players are often inside iframes
  main() {
    // The button lives in a shadow root so the page's CSS can't restyle it.
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        button { position: fixed; z-index: 2147483647; display: flex; align-items: center; gap: 6px;
          padding: 5px 10px; border: 0; border-radius: 6px; background: rgba(17,24,39,.9); color: #fff;
          font: 600 12px system-ui, sans-serif; cursor: pointer; transform: translateX(-100%); }
        button[hidden] { display: none; }
        button.no { cursor: not-allowed; }
        i { width: 8px; height: 8px; border-radius: 50%; }
      </style>
      <button hidden><i></i><span></span></button>`;
    document.documentElement.append(host);

    // Settings page switch: hide the on-video button everywhere.
    let enabled = true;
    browser.storage.local.get({ showVideoButton: true }).then((s) => (enabled = s.showVideoButton));
    browser.storage.onChanged.addListener((c) => {
      if (c.showVideoButton) enabled = c.showVideoButton.newValue;
    });

    const btn = root.querySelector('button');
    const dot = root.querySelector('i');
    const label = root.querySelector('span');
    let video = null;
    let info = null; // the file found for this video, or null
    let hideTimer = 0;

    const hide = () => {
      btn.hidden = true;
      video = null;
    };

    async function show(v) {
      if (v === video) return;
      video = v;
      info = null; // otherwise a click while "Checking…" would download the previous video
      const r = v.getBoundingClientRect();
      btn.style.top = `${Math.max(r.top, 0) + 8}px`;
      btn.style.left = `${Math.min(r.right, innerWidth) - 8}px`;
      btn.hidden = false;
      dot.style.background = '#9ca3af';
      label.textContent = 'Checking…';

      let f;
      try {
        f = await browser.runtime.sendMessage({ type: 'video-info', src: v.currentSrc || v.src });
      } catch {
        // Grablight was reloaded or updated: this page still has the old script. A page reload fixes it.
        label.textContent = 'Reload this page';
        return;
      }
      if (v !== video) return; // moved to another video meanwhile
      info = f;
      const l = f?.light || { color: 'red', reason: "No file found: this video is streamed" };
      dot.style.background = COLORS[l.color];
      label.textContent = LABELS[l.color];
      btn.title = l.reason;
      btn.classList.toggle('no', l.color === 'red');
    }

    // Like document.elementsFromPoint, but also looks inside open shadow roots, where some players live.
    // ponytail: closed shadow roots can't be seen from here.
    const videoAt = (x, y, root = document) => {
      for (const el of root.elementsFromPoint(x, y)) {
        if (el.tagName === 'VIDEO' && el.clientWidth >= 120) return el;
        const inner = el.shadowRoot && videoAt(x, y, el.shadowRoot);
        if (inner) return inner;
      }
    };

    // The page often puts overlays on top of the video, so ask "what is under the pointer?"
    // instead of listening on the video itself.
    document.addEventListener(
      'mousemove',
      (e) => {
        if (!enabled) return hide();
        const v = videoAt(e.clientX, e.clientY);
        if (v) {
          clearTimeout(hideTimer);
          hideTimer = 0;
          show(v);
        } else if (!hideTimer) {
          hideTimer = setTimeout(() => {
            hideTimer = 0;
            hide();
          }, 600);
        }
      },
      { capture: true, passive: true },
    );
    // The button is fixed to the screen, the video isn't: hide it rather than let it drift.
    addEventListener('scroll', hide, { capture: true, passive: true });

    btn.addEventListener('click', async () => {
      if (!info || info.light.color === 'red') return;
      label.textContent = 'Downloading…'; // streams can take a while
      btn.title = 'Click the Grablight icon in the toolbar to watch, stop or delete it';
      const r = await browser.runtime.sendMessage({ type: 'download', file: info }).catch(() => null);
      label.textContent = r?.ok ? 'Started' : r?.error === 'Stopped' ? 'Stopped' : `Failed: ${r?.error || 'unknown error'}`;
    });
  },
});
