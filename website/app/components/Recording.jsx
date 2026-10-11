'use client';

import { useEffect, useState } from 'react';

// One screen recording. The file lives in website/public/demo/. Until it is added, the tile says so.
export default function Recording({ n, file, title, text, result, refused = false, tone }) {
  const [missing, setMissing] = useState(false);

  // The video's error event can fire before React hydrates, so ask the server directly too.
  useEffect(() => {
    fetch(file, { method: 'HEAD' })
      .then((res) => {
        if (!res.ok || !(res.headers.get('content-type') || '').startsWith('video/')) setMissing(true);
      })
      .catch(() => setMissing(true));
  }, [file]);

  return (
    <article className="glass grid gap-6 p-4 lg:grid-cols-[1.7fr_1fr] lg:items-center lg:p-5">
      <div className={`relative aspect-video overflow-hidden rounded-[16px] ${tone}`}>
        {missing ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-olive">
              <span className="ml-1 border-y-[11px] border-l-[17px] border-y-transparent border-l-bg" />
            </span>
            <span className="text-sm font-semibold">Recording {n} coming soon</span>
            <span className="font-mono text-[11px] text-dim">{file}</span>
          </div>
        ) : (
          <video
            className="absolute inset-0 h-full w-full object-cover"
            src={file}
            poster={file.replace('.mp4', '.jpg')}
            controls
            playsInline
            preload="metadata"
            aria-label={title}
            onError={() => setMissing(true)}
          />
        )}
      </div>
      <div className="px-2 pb-2 lg:pb-0 lg:pr-6">
        <h3 className="text-2xl font-semibold leading-tight tracking-tight">{title}</h3>
        <p className="mt-2 leading-relaxed text-dim">{text}</p>
        <span
          className={`mt-4 inline-block rounded-full border border-olive px-4 py-1.5 text-sm font-semibold ${
            refused ? 'bg-olive text-bg' : ''
          }`}
        >
          {result}
        </span>
      </div>
    </article>
  );
}
