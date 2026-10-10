import { useEffect, useState } from 'react';
import { DEFAULTS, getSettings } from '../../utils/settings.js';

const QUALITIES = [
  ['ask', 'Ask'],
  ['best', 'Best'],
  ['1080', '1080p'],
  ['720', '720p'],
  ['480', '480p'],
];

// One setting: what it is on the left, how to change it on the right. Rows are split by hairlines.
function Setting({ id, title, children, control, wide }) {
  return (
    <div className={`grid gap-4 border-t border-hair py-6 ${wide ? '' : 'sm:grid-cols-[1fr_auto] sm:items-center sm:gap-10'}`}>
      <div className="max-w-[46ch]">
        <label htmlFor={id} className="block text-[15px] font-medium tracking-tight">
          {title}
        </label>
        <p className="mt-1 text-[13px] leading-relaxed text-dim">{children}</p>
      </div>
      {control}
    </div>
  );
}

// A switch is a button, so it works with the keyboard and screen readers.
function Switch({ id, on, onChange }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`press relative h-7 w-12 shrink-0 rounded-full border border-hair transition-colors ${on ? 'bg-ink' : 'bg-plate'}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5.5 w-5.5 rounded-full transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          on ? 'translate-x-5 bg-room' : 'bg-dim'
        }`}
      />
    </button>
  );
}

export default function App() {
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  // Every change is saved straight away, so there is no Save button to forget.
  const change = async (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await browser.storage.local.set(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
  };

  const [cleared, setCleared] = useState(false);
  const clearHistory = async () => {
    await browser.storage.local.remove('history');
    setCleared(true);
    setTimeout(() => setCleared(false), 1400);
  };

  if (!settings) return null;

  return (
    <div className="mx-auto grid min-h-screen max-w-5xl gap-10 px-6 py-12 md:grid-cols-[220px_1fr] md:gap-16 md:py-20">
      <aside className="md:sticky md:top-20 md:self-start">
        <img src="/icon/48.png" alt="" className="h-9 w-9" />
        <h1 className="mt-5 text-2xl font-semibold tracking-tighter">Grablight</h1>
        <p className="mt-1 font-mono text-[11px] uppercase tracking-widest text-dim">Settings</p>
        <p
          role="status"
          className={`mt-6 flex items-center gap-2 font-mono text-[11px] text-dim transition-opacity duration-300 ${saved ? 'opacity-100' : 'opacity-0'}`}
        >
          <span className="lens text-green" /> Saved
        </p>
      </aside>

      <main>
        <Setting
          id="button"
          title="Download button over media"
          control={<Switch id="button" on={settings.showVideoButton} onChange={(v) => change({ showVideoButton: v })} />}
        >
          The small button that appears when you point at a video or a large image. Turn it off to use only the toolbar
          popup. It applies to pages you open or reload next.
        </Setting>

        <Setting
          id="quality"
          title="Default stream quality"
          wide
          control={
            <div id="quality" role="radiogroup" aria-label="Default stream quality" className="grid grid-cols-5 gap-px rounded-md bg-plate p-1">
              {QUALITIES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={settings.streamQuality === value}
                  onClick={() => change({ streamQuality: value })}
                  className={`press rounded px-3 py-2 text-[13px] ${
                    settings.streamQuality === value ? 'bg-ink font-medium text-room' : 'text-dim hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          }
        >
          For videos that come in several qualities. “Ask” shows a picker in the popup. The button over a video has no room for a
          picker, so there “Ask” means the best quality that fits in memory. A number means that quality or the next lower one.
        </Setting>

        <Setting
          id="blocked"
          title="Sites to never take video or audio from"
          wide
          control={
            <textarea
              id="blocked"
              rows={5}
              value={settings.blockedSites}
              placeholder={'example.com\nother.org'}
              onChange={(e) => change({ blockedSites: e.target.value })}
              className="w-full resize-y rounded-md border border-hair bg-plate p-3 font-mono text-[13px] placeholder:text-dim/60"
            />
          }
        >
          One per line, or separated by commas. Subdomains are included. Grablight already skips YouTube, Netflix, Prime Video,
          Disney+, Hotstar and Spotify.
        </Setting>

        <div className="flex flex-wrap items-center gap-3 border-t border-hair py-6">
          <button type="button" onClick={clearHistory} className="press rounded-md border border-hair px-4 py-2.5 text-[13px] hover:bg-plate">
            {cleared ? 'History cleared' : 'Clear download history'}
          </button>
          <button type="button" onClick={() => change(DEFAULTS)} className="press rounded-md px-4 py-2.5 text-[13px] text-dim hover:text-ink">
            Reset settings
          </button>
        </div>

        <p className="border-t border-hair pt-6 text-xs leading-relaxed text-dim">
          Everything here stays in this browser. Grablight has no account and sends nothing to any server of ours.
        </p>
      </main>
    </div>
  );
}
