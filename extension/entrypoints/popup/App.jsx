import { useEffect, useRef, useState } from 'react';
import { pickQuality } from '../../utils/hls.js';

const DOT = { green: 'bg-emerald-500', yellow: 'bg-amber-500', red: 'bg-red-500' };
const ORDER = { green: 0, yellow: 1, red: 2 };

const size = (n) => (!(n > 0) ? '' : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.ceil(n / 1e3)} KB`);

export default function App() {
  const [files, setFiles] = useState(null); // null = still scanning
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [tab, setTab] = useState('files');
  const [picking, setPicking] = useState(null); // url of the stream whose quality picker is open
  const [pref, setPref] = useState('ask'); // default stream quality from settings
  const tabId = useRef();
  const dl = useDownloads();

  // The background script does the downloading (streams take a while and need it).
  // If you close the popup meanwhile, the download carries on; the toolbar icon shows progress.
  const download = async (f, variantUrl) => {
    setNote('');
    setPicking(null);
    setTab('downloads'); // show it straight away: progress, stop and delete live there
    const r = await browser.runtime.sendMessage({ type: 'download', tabId: tabId.current, file: f, variantUrl });
    if (!r?.ok && r?.error !== 'Stopped') setNote(`Failed: ${r?.error || 'unknown error'}`);
  };

  useEffect(() => {
    browser.storage.local.get({ streamQuality: 'ask' }).then((s) => setPref(s.streamQuality));
    (async () => {
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        tabId.current = tab.id;
        const list = await browser.runtime.sendMessage({ type: 'analyze', tabId: tab.id });
        setFiles([...list].sort((a, b) => ORDER[a.light.color] - ORDER[b.light.color]));
      } catch {
        setError("Grablight can't scan this page.");
        setFiles([]);
      }
    })();
  }, []);

  const ok = files?.filter((f) => f.light.color !== 'red') || [];

  return (
    <main className="p-4 font-sans text-slate-800">
      <header className="flex items-center gap-2">
        <img src="/icon/32.png" alt="" className="h-6 w-6" />
        <h1 className="text-lg font-semibold">Grablight</h1>
        {files && tab === 'files' && <span className="ml-auto text-xs text-slate-500">{files.length} found</span>}
        <button
          type="button"
          onClick={() => browser.runtime.openOptionsPage()}
          className={`${tab === 'files' && files ? '' : 'ml-auto '}rounded px-1.5 text-xs text-slate-500 hover:bg-slate-100`}
        >
          Settings
        </button>
      </header>

      <nav className="mt-3 flex gap-1 border-b border-slate-200 text-sm">
        {['files', 'downloads', 'history'].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-1 capitalize ${
              tab === t ? 'border-emerald-600 font-medium text-emerald-700' : 'border-transparent text-slate-500'
            }`}
          >
            {t}
            {t === 'downloads' && dl.active > 0 && ` (${dl.active})`}
          </button>
        ))}
      </nav>

      {note && <p className="mt-3 text-sm text-red-600">{note}</p>}
      {tab === 'downloads' && <Downloads {...dl} />}
      {tab === 'history' && <History />}

      {tab === 'files' && (
        <>
      {files === null && <p className="mt-3 text-sm text-slate-500">Scanning…</p>}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {files?.length === 0 && !error && (
        <p className="mt-3 text-sm text-slate-500">No files found on this page.</p>
      )}

      {ok.length > 0 && (
        <button
          type="button"
          onClick={() => ok.forEach(download)}
          className="mt-3 w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Download all that can ({ok.length})
        </button>
      )}

      <ul className="mt-3 max-h-96 space-y-1 overflow-y-auto">
        {files?.map((f) => (
          <FileRow key={f.url} f={f} pref={pref} open={picking === f.url} setOpen={(o) => setPicking(o ? f.url : null)} download={download} />
        ))}
      </ul>
        </>
      )}
    </main>
  );
}

// One file in the Files tab. A stream that comes in several qualities opens a picker instead of
// downloading straight away.
function FileRow({ f, pref, open, setOpen, download }) {
  const many = f.kind === 'manifest' && f.qualities?.length > 1;
  const meta = [f.ext || f.kind, many && `${f.qualities.length} qualities`, size(f.size), f.light.color !== 'green' && f.light.reason];
  return (
    <li className="rounded-md bg-slate-50 px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[f.light.color]}`} title={f.light.reason} />
        <span className="min-w-0 flex-1" title={f.url}>
          <span className="block truncate text-sm">{f.name}</span>
          <span className="block truncate text-[11px] text-slate-500">{meta.filter(Boolean).join(' · ')}</span>
        </span>
        <button
          type="button"
          disabled={f.light.color === 'red'}
          aria-expanded={many ? open : undefined}
          onClick={() => (many ? setOpen(!open) : download(f))}
          className="rounded px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:text-slate-300 disabled:hover:bg-transparent"
        >
          {many && open ? 'Close' : 'Download'}
        </button>
      </div>
      {many && open && <QualityPicker f={f} pref={pref} onDownload={(url) => download(f, url)} />}
    </li>
  );
}

// Choose a stream quality. Each option shows an estimated size; ones too big to join in memory can't be picked.
function QualityPicker({ f, pref, onDownload }) {
  const [choice, setChoice] = useState(() => pickQuality(f.qualities, pref === 'ask' ? 'best' : pref)?.url);
  const picked = f.qualities.find((q) => q.url === choice);
  return (
    <fieldset className="mt-2 grid gap-1 border-0 p-0">
      <legend className="mb-1 text-xs font-semibold">Quality</legend>
      {f.qualities.map((q) => (
        <label
          key={q.url}
          className={`grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-md bg-slate-100 px-2 py-1.5 text-sm ${
            q.tooBig ? 'cursor-not-allowed opacity-55' : 'cursor-pointer'
          } ${choice === q.url ? 'outline outline-2 outline-slate-800' : ''}`}
        >
          <input type="radio" name={`q-${f.url}`} checked={choice === q.url} disabled={q.tooBig} onChange={() => setChoice(q.url)} />
          <span>
            {q.label}
            {q.tooBig && <small className="block text-[11px] text-slate-500">Too big to join in memory (over 1.5 GB)</small>}
          </span>
          <span className="text-xs tabular-nums">about {size(q.est)}</span>
        </label>
      ))}
      <button
        type="button"
        disabled={!picked}
        onClick={() => onDownload(choice)}
        className="mt-1 w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {picked ? `Download ${picked.label}, about ${size(picked.est)}` : 'Nothing fits in memory'}
      </button>
    </fieldset>
  );
}

// Live view of what Grablight is downloading. Normal downloads come straight from Chrome's
// downloads list (only the ones this extension started); streams still fetching pieces are
// jobs kept by the background script. Refreshed twice a second while the popup is open.
function useDownloads() {
  const [state, setState] = useState({ items: [], jobs: {} });
  useEffect(() => {
    const tick = async () => {
      const all = await browser.downloads.search({ orderBy: ['-startTime'], limit: 30 });
      const { jobs = {} } = await browser.storage.session.get('jobs');
      setState({ items: all.filter((d) => d.byExtensionId === browser.runtime.id).slice(0, 10), jobs });
    };
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, []);
  const active = Object.keys(state.jobs).length + state.items.filter((d) => d.state === 'in_progress').length;
  return { ...state, active };
}

// A small text button. confirm: the first click only arms it ("Sure?"), the second does it.
function Act({ label, onClick, danger, confirm }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        if (confirm && !armed) {
          setArmed(true);
          setTimeout(() => setArmed(false), 3000);
        } else onClick();
      }}
      className={`rounded px-2 py-0.5 text-xs font-medium ${
        danger ? 'text-red-600 hover:bg-red-50' : 'text-emerald-700 hover:bg-emerald-100'
      }`}
    >
      {armed ? 'Sure?' : label}
    </button>
  );
}

const Bar = ({ value }) => (
  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-200">
    <span
      className={`block h-full bg-emerald-500 ${value == null ? 'w-1/3 animate-pulse' : ''}`}
      style={value == null ? undefined : { width: `${Math.round(value * 100)}%` }}
    />
  </span>
);

function Row({ name, detail, bar, children }) {
  return (
    <li className="rounded-md bg-slate-50 px-2 py-1.5">
      <span className="block truncate text-sm">{name}</span>
      {bar !== undefined && <Bar value={bar} />}
      <span className="mt-1 flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">{detail}</span>
        {children}
      </span>
    </li>
  );
}

function Downloads({ items, jobs }) {
  const remove = (id) => browser.downloads.erase({ id }); // only forgets it, keeps the file
  // Deleting removes the file from disk too. removeFile fails if it is already gone: still forget it.
  const del = async (id) => {
    await browser.downloads.removeFile(id).catch(() => {});
    await browser.downloads.erase({ id });
  };

  if (!items.length && !Object.keys(jobs).length) {
    return <p className="mt-3 text-sm text-slate-500">Nothing downloading. Start one from the Files tab or from a video.</p>;
  }
  return (
    <ul className="mt-3 max-h-96 space-y-1 overflow-y-auto">
      {Object.entries(jobs).map(([id, j]) => (
        <Row
          key={id}
          name={j.name}
          bar={j.total ? j.done / j.total : null}
          detail={j.total ? `Fetching stream: ${j.done} of ${j.total} pieces` : 'Reading stream…'}
        >
          <Act label="Stop" danger onClick={() => browser.runtime.sendMessage({ type: 'cancel-job', jobId: id })} />
        </Row>
      ))}

      {items.map((d) => {
        const name = d.filename.split(/[\\/]/).pop() || d.url;
        if (d.state === 'in_progress') {
          const known = d.totalBytes > 0;
          return (
            <Row
              key={d.id}
              name={name}
              bar={known ? d.bytesReceived / d.totalBytes : null}
              detail={d.paused ? 'Paused' : known ? `${size(d.bytesReceived)} of ${size(d.totalBytes)}` : 'Downloading…'}
            >
              {d.paused ? (
                <Act label="Resume" onClick={() => browser.downloads.resume(d.id)} />
              ) : (
                <Act label="Pause" onClick={() => browser.downloads.pause(d.id)} />
              )}
              <Act label="Stop" danger onClick={() => browser.downloads.cancel(d.id)} />
            </Row>
          );
        }
        if (d.state === 'complete') {
          return (
            <Row key={d.id} name={name} detail={`Done${d.exists ? '' : ' (file was moved or deleted)'} · ${size(d.fileSize)}`}>
              {d.exists && <Act label="Show" onClick={() => browser.downloads.show(d.id)} />}
              <Act label={d.exists ? 'Delete' : 'Remove'} danger confirm={d.exists} onClick={() => del(d.id)} />
            </Row>
          );
        }
        return (
          <Row key={d.id} name={name} detail={d.error === 'USER_CANCELED' ? 'Stopped' : `Failed: ${d.error || 'unknown'}`}>
            <Act label="Remove" onClick={() => remove(d.id)} />
          </Row>
        );
      })}
    </ul>
  );
}

// Everything you downloaded through Grablight, newest first. Kept on this computer only.
function History() {
  const [items, setItems] = useState(null);
  useEffect(() => {
    const load = () => browser.storage.local.get({ history: [] }).then((s) => setItems(s.history));
    load();
    browser.storage.onChanged.addListener(load);
    return () => browser.storage.onChanged.removeListener(load);
  }, []);

  if (!items) return null;
  if (!items.length) return <p className="mt-3 text-sm text-slate-500">Nothing downloaded yet.</p>;
  return (
    <>
      <ul className="mt-3 max-h-96 space-y-1 overflow-y-auto">
        {items.map((h) => (
          <li key={h.time + h.url} className="rounded-md bg-slate-50 px-2 py-1.5" title={h.url}>
            <span className="block truncate text-sm">{h.name}</span>
            <span className="block truncate text-[11px] text-slate-500">
              {[new Date(h.time).toLocaleString(), h.page && new URL(h.page).hostname].filter(Boolean).join(' · ')}
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => browser.storage.local.remove('history')}
        className="mt-3 text-xs text-slate-500 hover:text-red-600"
      >
        Clear history
      </button>
    </>
  );
}
