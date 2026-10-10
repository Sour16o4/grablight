// Phase 5: a small button that appears over any video (or large image) you hover, with its light.
// It runs inside the web page; the background script does the real work
// (finding the file, downloading), because only it can use the downloads API.
const COLORS = { green: '#59b88a', yellow: '#d9a441', red: '#d2605a' };
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
        button { position: fixed; z-index: 2147483647; display: flex; align-items: center; gap: 8px;
          padding: 6px 11px 6px 9px; border: 1px solid rgba(236,234,228,.12); border-radius: 8px;
          background: #0e0e10; color: #eceae4; font: 500 12px ui-sans-serif, system-ui, sans-serif;
          letter-spacing: -.005em; cursor: pointer; transform: translateX(-100%);
          animation: in .3s cubic-bezier(.22,1,.36,1) both; transition: background-color .15s; }
        button:hover { background: #17171a; }
        button:active { transform: translateX(-100%) translateY(1px); }
        button[hidden] { display: none; }
        button.no { cursor: not-allowed; opacity: .9; }
        i { width: 9px; height: 9px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 3px rgba(140,140,148,.22); }
        small { font: 500 11px ui-monospace, monospace; color: #8c8c94; }
        .wait span { background: linear-gradient(90deg,#8c8c94,#eceae4,#8c8c94) 0 0/200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: shim 1.2s linear infinite; }
        @keyframes in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes shim { to { background-position: -200% 0; } }
        @media (prefers-reduced-motion: reduce) { button, .wait span { animation: none; } }
      </style>
      <button hidden><i></i><span></span><small></small></button>`;
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
    const meta = root.querySelector('small');
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
      dot.style.color = '#8c8c94';
      btn.classList.add('wait');
      meta.textContent = '';
      label.textContent = 'Checking…';

      let f;
      try {
        f = await browser.runtime.sendMessage({ type: 'video-info', src: v.currentSrc || v.src, image: v.tagName === 'IMG' });
      } catch {
        // Grablight was reloaded or updated: this page still has the old script. A page reload fixes it.
        btn.classList.remove('wait');
        label.textContent = 'Reload this page';
        return;
      }
      if (v !== video) return; // moved to another video meanwhile
      info = f;
      const l = f?.light || { color: 'red', reason: `No file found: this ${v.tagName === 'IMG' ? 'image is not a separate file' : 'video is streamed'}` };
      btn.classList.remove('wait');
      dot.style.color = COLORS[l.color];
      label.textContent = LABELS[l.color];
      meta.textContent = f?.size > 0 ? (f.size >= 1e9 ? `${(f.size / 1e9).toFixed(1)} GB` : f.size > 1e6 ? `${(f.size / 1e6).toFixed(1)} MB` : `${Math.ceil(f.size / 1e3)} KB`) : '';
      btn.title = l.reason;
      btn.classList.toggle('no', l.color === 'red');
    }

    // Like document.elementsFromPoint, but also looks inside open shadow roots, where some players live.
    // ponytail: closed shadow roots can't be seen from here.
    const mediaAt = (x, y, root = document) => {
      for (const el of root.elementsFromPoint(x, y)) {
        if ((el.tagName === 'VIDEO' || el.tagName === 'IMG') && el.clientWidth >= 120) return el;
        const inner = el.shadowRoot && mediaAt(x, y, el.shadowRoot);
        if (inner) return inner;
      }
    };

    // The page often puts overlays on top of the video, so ask "what is under the pointer?"
    // instead of listening on the video itself.
    document.addEventListener(
      'mousemove',
      (e) => {
        if (!enabled) return hide();
        const v = mediaAt(e.clientX, e.clientY);
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
      label.textContent = r?.ok ? (r.note ? 'Started, no sound' : 'Started') : r?.error === 'Stopped' ? 'Stopped' : `Failed: ${r?.error || 'unknown error'}`;
    });
  },
});
