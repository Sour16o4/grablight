import { useEffect, useState } from 'react';
import { DEFAULTS, getSettings } from '../../utils/settings.js';

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
    setTimeout(() => setSaved(false), 1200);
  };

  const clearHistory = () => browser.storage.local.remove('history');

  if (!settings) return null;

  return (
    <main className="mx-auto max-w-xl p-8 font-sans text-slate-800">
      <header className="flex items-center gap-3">
        <img src="/icon/48.png" alt="" className="h-8 w-8" />
        <h1 className="text-2xl font-semibold">Grablight settings</h1>
        <span className={`ml-auto text-sm text-emerald-600 transition-opacity ${saved ? 'opacity-100' : 'opacity-0'}`}>
          Saved
        </span>
      </header>

      <section className="mt-8">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={settings.showVideoButton}
            onChange={(e) => change({ showVideoButton: e.target.checked })}
            className="mt-1 h-4 w-4"
          />
          <span>
            <span className="block font-medium">Show the Download button over videos</span>
            <span className="block text-sm text-slate-500">
              Turn off to use only the toolbar popup. Takes effect on pages you open or reload next.
            </span>
          </span>
        </label>
      </section>

      <section className="mt-8">
        <label htmlFor="blocked" className="block font-medium">
          Sites to never download video or audio from
        </label>
        <p className="text-sm text-slate-500">
          One per line or separated by commas. Subdomains are included. Grablight already skips YouTube, Netflix, Prime
          Video, Disney+, Hotstar and Spotify.
        </p>
        <textarea
          id="blocked"
          rows={5}
          value={settings.blockedSites}
          placeholder={'example.com\nother.org'}
          onChange={(e) => change({ blockedSites: e.target.value })}
          className="mt-2 w-full rounded-md border border-slate-300 p-2 font-mono text-sm"
        />
      </section>

      <section className="mt-8">
        <label htmlFor="quality" className="block font-medium">
          Default stream quality
        </label>
        <p className="text-sm text-slate-500">
          For video streams that come in several qualities. The button over videos has no room for a picker, so with
          “Ask” it uses the best quality that fits in memory.
        </p>
        <select
          id="quality"
          value={settings.streamQuality}
          onChange={(e) => change({ streamQuality: e.target.value })}
          className="mt-2 rounded-md border border-slate-300 p-2 text-sm"
        >
          <option value="ask">Ask me in the popup</option>
          <option value="best">Best that fits in memory</option>
          <option value="1080">1080p or lower</option>
          <option value="720">720p or lower</option>
          <option value="480">480p or lower</option>
        </select>
      </section>

      <section className="mt-8 flex items-center gap-4">
        <button
          type="button"
          onClick={clearHistory}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
        >
          Clear download history
        </button>
        <button
          type="button"
          onClick={() => change(DEFAULTS)}
          className="rounded-md px-3 py-2 text-sm text-slate-500 hover:bg-slate-50"
        >
          Reset settings
        </button>
      </section>

      <p className="mt-10 text-xs text-slate-400">
        Everything here stays in this browser. Grablight has no account and sends nothing to any server of ours.
      </p>
    </main>
  );
}
