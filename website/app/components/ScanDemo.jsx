'use client';

import { useEffect, useRef, useState } from 'react';

// Sample pages for the demo. The reasons are the extension's own wording (extension/utils/light.js).
const PAGES = [
  {
    id: 'course',
    tab: 'Course page',
    host: 'course-site.example',
    files: [
      { name: 'lecture-notes.pdf', tile: 'PDF', meta: 'pdf', color: 'green' },
      { name: 'week-2-slides.pdf', tile: 'PDF', meta: 'pdf', color: 'green' },
      { name: 'reading-list.zip', tile: 'ZIP', meta: 'zip', color: 'green' },
    ],
  },
  {
    id: 'stream',
    tab: 'Event stream',
    host: 'events.example',
    files: [
      { name: 'Launch event (stream)', tile: 'HLS', meta: 'm3u8', color: 'green', note: 'Video stream: pieces are joined into one file' },
      { name: 'promo-clip.mp4', tile: 'MP4', meta: 'mp4', color: 'amber', note: "Couldn't check this file" },
    ],
  },
  {
    id: 'blocked',
    tab: 'Blocked site',
    host: 'video-site.example',
    files: [
      { name: 'episode-1.mp4', tile: 'MP4', meta: 'mp4', color: 'red', note: "This site doesn't allow downloads" },
      { name: 'episode-2.mp4', tile: 'MP4', meta: 'mp4', color: 'red', note: "This site doesn't allow downloads" },
    ],
  },
];

export default function ScanDemo() {
  const [pageId, setPageId] = useState('course');
  const [scanning, setScanning] = useState(true);
  const [state, setState] = useState({}); // file name -> 'busy' | 'done'
  const timers = useRef([]);

  const page = PAGES.find((p) => p.id === pageId);
  const count = (c) => page.files.filter((f) => f.color === c).length;
  const canDownload = page.files.filter((f) => f.color !== 'red');

  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));
  useEffect(() => {
    later(() => setScanning(false), 900);
    return () => timers.current.forEach(clearTimeout);
  }, []);

  const choose = (id) => {
    if (id === pageId) return;
    timers.current.forEach(clearTimeout);
    setPageId(id);
    setState({});
    setScanning(true);
    later(() => setScanning(false), 800);
  };

  const grab = (names) => {
    names.forEach((n) => {
      if (state[n]) return;
      setState((s) => ({ ...s, [n]: 'busy' }));
      later(() => setState((s) => ({ ...s, [n]: 'done' })), 1650);
    });
  };

  return (
    <div>
      <div className="glass mx-auto w-full max-w-[400px] p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-base font-semibold tracking-tight">Grablight</span>
          <span className="font-mono text-[11px] text-dim">{page.host}</span>
        </div>

        <div className="mt-3 flex items-center gap-4 font-mono text-[11px] text-dim" aria-live="polite">
          {scanning ? (
            <span>Checking {page.files.length} files...</span>
          ) : (
            <>
              <span className="flex items-center gap-2"><i className="lens lens-green" />{count('green')} ready</span>
              <span className="flex items-center gap-2"><i className="lens lens-amber" />{count('amber')} may fail</span>
              <span className="flex items-center gap-2"><i className="lens lens-red" />{count('red')} blocked</span>
            </>
          )}
        </div>

        <button
          type="button"
          disabled={scanning || canDownload.length === 0}
          onClick={() => grab(canDownload.map((f) => f.name))}
          className="btn btn-solid mt-3 w-full !py-2.5 text-[13px] disabled:cursor-not-allowed disabled:opacity-35"
        >
          Download all {scanning ? 0 : canDownload.length}
        </button>

        <ul className="mt-3 min-h-[190px]">
          {scanning
            ? page.files.map((f) => <li key={f.name} className="skeleton mb-1.5 h-[56px]" aria-hidden="true" />)
            : page.files.map((f, i) => {
                const st = state[f.name];
                return (
                  <li
                    key={f.name}
                    className={`rise relative flex items-center gap-3 py-2.5 ${i ? 'border-t border-line' : ''}`}
                    style={{ '--i': i }}
                  >
                    <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] bg-olive/10 font-mono text-[10px] text-dim">
                      {f.tile}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{f.name}</span>
                      <span className="block truncate font-mono text-[10.5px] text-dim">{f.note || f.meta}</span>
                    </span>
                    <i className={`lens lens-${f.color} lens-on`} style={{ '--i': i }} />
                    <button
                      type="button"
                      disabled={f.color === 'red' || !!st}
                      onClick={() => grab([f.name])}
                      className="w-[76px] flex-none rounded-lg px-2 py-1 text-[12px] font-medium transition-colors hover:bg-olive/10 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:opacity-60"
                    >
                      {f.color === 'red' ? 'Blocked' : st === 'done' ? 'Saved' : st === 'busy' ? 'Saving' : 'Download'}
                    </button>
                    {st === 'busy' && (
                      <span className="absolute inset-x-0 bottom-0 h-[2px] bg-olive/15">
                        <span className="progress block h-full bg-olive" />
                      </span>
                    )}
                  </li>
                );
              })}
        </ul>
      </div>

      <div role="tablist" aria-label="Sample page" className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-2 text-[12px] font-medium sm:gap-x-6 sm:text-sm">
        {PAGES.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={p.id === pageId}
            onClick={() => choose(p.id)}
            className={`border-b-2 pb-1.5 ${p.id === pageId ? 'border-olive' : 'border-transparent opacity-60'}`}
          >
            {p.tab}
          </button>
        ))}
      </div>
    </div>
  );
}
