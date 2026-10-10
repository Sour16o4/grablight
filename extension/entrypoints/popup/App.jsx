import { useEffect, useRef, useState } from 'react';
import { pickQuality } from '../../utils/hls.js';

// The light is the only colour in the popup. See DESIGN.md.
const LENS = { green: 'text-green', yellow: 'text-amber', red: 'text-red' };
const ORDER = { green: 0, yellow: 1, red: 2 };
const GROUPS = [
  ['video', 'Video'],
  ['audio', 'Audio'],
  ['image', 'Image'],
  ['file', 'File'],
];
// Streams (manifest) are videos to the person using the popup.
const groupOf = (f) => (f.kind === 'manifest' ? 'video' : GROUPS.some(([k]) => k === f.kind) ? f.kind : 'file');

const size = (n) => (!(n > 0) ? '' : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.ceil(n / 1e3)} KB`);
const mono = 'font-mono text-[11px] tracking-tight text-dim';

const Lens = ({ color, reason }) => <span className={`lens shrink-0 ${LENS[color]}`} title={reason} aria-label={color} />;

// A drawn glyph for files that have no picture to show.
function Glyph({ kind }) {
  const d = {
    video: 'M4 5h10a1 1 0 0 1 1 1v3l5-3v12l-5-3v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
    audio: 'M9 18V6l10-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zm10-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3z',
    file: 'M6 3h8l5 5v13H6zM14 3v5h5',
  }[kind] || '';
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-dim" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const Thumb = ({ f }) => (
  <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-md bg-plate">
    {f.kind === 'image' ? (
      <img src={f.url} alt="" loading="lazy" className="h-full w-full object-cover" />
    ) : (
      <Glyph kind={groupOf(f)} />
    )}
  </span>
);

export default function App() {
  const [files, setFiles] = useState(null); // null = still scanning
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [tab, setTab] = useState('files');
  const [host, setHost] = useState('');
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
    else if (r?.note) setNote(r.note); // saved, but something is missing (e.g. no sound)
  };

  useEffect(() => {
    browser.storage.local.get({ streamQuality: 'ask' }).then((s) => setPref(s.streamQuality));
    (async () => {
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        tabId.current = tab.id;
        try {
          setHost(new URL(tab.url).hostname.replace(/^www\./, ''));
        } catch {} // chrome:// pages and the like have no host worth showing
        const list = await browser.runtime.sendMessage({ type: 'analyze', tabId: tab.id });
        setFiles([...list].sort((a, b) => ORDER[a.light.color] - ORDER[b.light.color]));
      } catch {
        setError("Grablight can't scan this page.");
        setFiles([]);
      }
    })();
  }, []);

  const ok = files?.filter((f) => f.light.color !== 'red') || [];
  const count = (c) => files?.filter((f) => f.light.color === c).length || 0;

  return (
    <main className="min-h-[200px]">
      <header className="flex items-baseline gap-3 px-4 pt-4">
        <h1 className="text-[15px] font-semibold tracking-tighter">Grablight</h1>
        <span className={`${mono} min-w-0 flex-1 truncate`}>{host}</span>
        <button type="button" onClick={() => browser.runtime.openOptionsPage()} className="press text-xs text-dim hover:text-ink">
          Settings
        </button>
      </header>

      <nav className="mt-3 flex gap-5 border-b border-hair px-4 text-[13px]">
        {[
          ['files', files ? files.length : null],
          ['downloads', dl.active || null],
          ['history', null],
        ].map(([t, n]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 pb-2 capitalize ${tab === t ? 'border-ink text-ink' : 'border-transparent text-dim hover:text-ink'}`}
          >
            {t}
            {n != null && <sup className="ml-1 font-mono text-[10px] text-dim">{n}</sup>}
          </button>
        ))}
      </nav>

      {note && <p className={`px-4 pt-3 text-xs ${note.startsWith('Failed') ? 'text-red' : 'text-amber'}`}>{note}</p>}
      {tab === 'downloads' && <Downloads {...dl} />}
      {tab === 'history' && <History />}

      {tab === 'files' && (
        <>
          {files === null && <Skeleton />}
          {error && <p className="px-4 pt-4 text-xs text-red">{error}</p>}
          {files?.length === 0 && !error && (
            <Empty>Nothing on this page yet. Press play or scroll: Grablight also watches the network.</Empty>
          )}

          {files?.length > 0 && (
            <>
              <div className="flex items-center gap-4 px-4 pt-3 font-mono text-[11px] text-dim">
                {[['green', 'ready'], ['yellow', 'may fail'], ['red', 'blocked']].map(([c, label]) => (
                  <span key={c} className="flex items-center gap-2">
                    <span className={`lens ${LENS[c]}`} />
                    <span className="text-ink">{count(c)}</span> {label}
                  </span>
                ))}
              </div>
              {ok.length > 0 && (
                <div className="px-4 pt-3">
                  <button
                    type="button"
                    onClick={() => ok.forEach((f) => download(f))}
                    className="press w-full rounded-md bg-ink px-3 py-2.5 text-[13px] font-medium text-room hover:bg-white"
                  >
                    Download {ok.length === files.length ? `all ${ok.length}` : `${ok.length} that can`}
                  </button>
                </div>
              )}

              <div className="mt-2 max-h-[420px] overflow-y-auto pb-3">
                {GROUPS.map(([kind, label]) => {
                  const rows = files.filter((f) => groupOf(f) === kind);
                  if (!rows.length) return null;
                  return (
                    <section key={kind}>
                      <h2 className="sticky top-0 z-10 flex items-center gap-2 bg-room px-4 pb-1 pt-3 font-mono text-[10px] uppercase tracking-widest text-dim">
                        {label}
                        <span className="text-ink">{rows.length}</span>
                      </h2>
                      <ul>
                        {rows.map((f, i) => (
                          <FileRow
                            key={f.url}
                            f={f}
                            i={i}
                            pref={pref}
                            open={picking === f.url}
                            setOpen={(o) => setPicking(o ? f.url : null)}
                            download={download}
                          />
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}

function Skeleton() {
  return (
    <div className="px-4 pt-4" aria-label="Scanning">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 border-t border-hair py-3">
          <span className="skeleton h-11 w-11 rounded-md" />
          <span className="grid flex-1 gap-2">
            <span className="skeleton h-3 w-2/3 rounded" />
            <span className="skeleton h-2.5 w-1/3 rounded" />
          </span>
        </div>
      ))}
    </div>
  );
}

function Empty({ children }) {
  return (
    <div className="grid place-items-center gap-3 px-8 py-10 text-center">
      <svg viewBox="0 0 48 48" className="h-12 w-12 fill-none stroke-dim" strokeWidth="1.2" aria-hidden="true">
        <circle cx="24" cy="24" r="19" />
        <path d="M24 5l8 14M43 24H27M24 43l-8-14M5 24h16M37.5 10.5L25 17M10.5 37.5L23 31" />
      </svg>
      <p className="max-w-[24ch] text-xs leading-relaxed text-dim">{children}</p>
    </div>
  );
}

// One file in the Files tab. A stream that comes in several qualities opens a picker instead of
// downloading straight away.
function FileRow({ f, i, pref, open, setOpen, download }) {
  const many = f.kind === 'manifest' && f.qualities?.length > 1;
  const meta = [f.ext || f.kind, many && `${f.qualities.length} qualities`, f.audio === 'separate' && 'sound joined', size(f.size)].filter(Boolean).join(' · ');
  return (
    <li className="rise border-t border-hair px-4 py-2.5 first:border-t-0" style={{ animationDelay: `${Math.min(i, 12) * 24}ms` }}>
      <div className="flex items-center gap-3">
        <Thumb f={f} />
        <span className="min-w-0 flex-1" title={f.url}>
          <span className="block truncate text-[13px]">{f.name}</span>
          <span className={`${mono} block truncate`}>{meta}</span>
          {f.light.color !== 'green' && <span className={`block text-[11px] leading-snug ${LENS[f.light.color]}`}>{f.light.reason}</span>}
        </span>
        <Lens color={f.light.color} reason={f.light.reason} />
        <button
          type="button"
          disabled={f.light.color === 'red'}
          aria-expanded={many ? open : undefined}
          onClick={() => (many ? setOpen(!open) : download(f))}
          className="press rounded-md border border-hair px-2.5 py-1.5 text-xs font-medium hover:bg-plate disabled:text-dim disabled:opacity-40 disabled:hover:bg-transparent"
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
    <fieldset className="mt-3 grid gap-px rounded-md bg-plate p-1">
      <legend className="sr-only">Quality</legend>
      {f.qualities.map((q) => (
        <label
          key={q.url}
          className={`grid grid-cols-[1fr_auto] items-center gap-2 border-l-2 px-3 py-2 ${
            choice === q.url ? 'border-ink bg-white/5' : 'border-transparent'
          } ${q.tooBig ? 'cursor-not-allowed opacity-45' : 'cursor-pointer hover:bg-white/5'}`}
        >
          <input
            type="radio"
            name={`q-${f.url}`}
            className="sr-only"
            checked={choice === q.url}
            disabled={q.tooBig}
            onChange={() => setChoice(q.url)}
          />
          <span className="text-[13px]">
            {q.label}
            {q.tooBig && <small className="block text-[11px] text-dim">Too big to join in memory (over 1.5 GB)</small>}
          </span>
          <span className={mono}>about {size(q.est)}</span>
        </label>
      ))}
      <button
        type="button"
        disabled={!picked}
        onClick={() => onDownload(choice)}
        className="press mt-1 rounded-md bg-ink px-3 py-2 text-[13px] font-medium text-room hover:bg-white disabled:opacity-40"
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
      className={`press rounded px-2 py-1 text-xs font-medium ${danger ? 'text-red hover:bg-red/10' : 'text-ink hover:bg-plate'}`}
    >
      {armed ? 'Sure?' : label}
    </button>
  );
}

// A 2px line, not a fat bar. No known total: a short segment pulses instead.
const Bar = ({ value }) => (
  <span className="mt-1.5 block h-0.5 overflow-hidden rounded-full bg-hair">
    <span
      className={`block h-full bg-ink ${value == null ? 'w-1/3 animate-pulse' : ''}`}
      style={value == null ? undefined : { width: `${Math.round(value * 100)}%` }}
    />
  </span>
);

function Row({ name, detail, bar, i = 0, children }) {
  return (
    <li className="rise border-t border-hair px-4 py-2.5 first:border-t-0" style={{ animationDelay: `${Math.min(i, 12) * 24}ms` }}>
      <span className="block truncate text-[13px]">{name}</span>
      {bar !== undefined && <Bar value={bar} />}
      <span className="mt-1 flex items-center gap-1">
        <span className={`${mono} min-w-0 flex-1 truncate`}>{detail}</span>
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
    return <Empty>Nothing downloading. Start one from the Files tab or from the button over a video.</Empty>;
  }
  return (
    <ul className="max-h-[460px] overflow-y-auto pt-2">
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

      {items.map((d, i) => {
        const name = d.filename.split(/[\\/]/).pop() || d.url;
        if (d.state === 'in_progress') {
          const known = d.totalBytes > 0;
          return (
            <Row
              key={d.id}
              i={i}
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
            <Row key={d.id} i={i} name={name} detail={`Done${d.exists ? '' : ' (file was moved or deleted)'} · ${size(d.fileSize)}`}>
              {d.exists && <Act label="Show" onClick={() => browser.downloads.show(d.id)} />}
              <Act label={d.exists ? 'Delete' : 'Remove'} danger confirm={d.exists} onClick={() => del(d.id)} />
            </Row>
          );
        }
        return (
          <Row key={d.id} i={i} name={name} detail={d.error === 'USER_CANCELED' ? 'Stopped' : `Failed: ${d.error || 'unknown'}`}>
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
  if (!items.length) return <Empty>Nothing downloaded yet.</Empty>;
  return (
    <>
      <ul className="max-h-[420px] overflow-y-auto pt-2">
        {items.map((h, i) => (
          <li key={h.time + h.url} className="rise border-t border-hair px-4 py-2.5 first:border-t-0" style={{ animationDelay: `${Math.min(i, 12) * 24}ms` }} title={h.url}>
            <span className="block truncate text-[13px]">{h.name}</span>
            <span className={`${mono} block truncate`}>
              {[new Date(h.time).toLocaleString(), h.page && new URL(h.page).hostname].filter(Boolean).join(' · ')}
            </span>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => browser.storage.local.remove('history')} className="press px-4 py-3 text-xs text-dim hover:text-red">
        Clear history
      </button>
    </>
  );
}
