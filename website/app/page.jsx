// Single-page site for the Grablight extension. Copy is plain on purpose: it says what the
// extension does, what it refuses to do, and what it can see.

const DEMO = [
  { name: 'lecture-notes.pdf', note: 'pdf · 2.4 MB', color: 'bg-go' },
  { name: 'Launch event (stream)', note: 'Video stream: pieces are joined into one file', color: 'bg-go' },
  { name: 'promo-clip.mp4', note: "Couldn't check this file", color: 'bg-caution' },
  { name: 'episode-1.mp4', note: "This site doesn't allow downloads", color: 'bg-stop' },
];

const LIGHTS = [
  {
    color: 'bg-go',
    title: 'Green: it will download',
    text: 'The file answered, it is a real file, and nothing blocks it. One click saves it.',
  },
  {
    color: 'bg-caution',
    title: 'Yellow: it may fail',
    text: "Grablight couldn't fully check it, for example because the server refuses preview requests. You can still try.",
  },
  {
    color: 'bg-stop',
    title: 'Red: it can’t be downloaded',
    text: 'The reason is shown next to the file: the server said no, it needs a login, it is a live stream, or it is protected by DRM.',
  },
];

const Section = ({ id, title, children }) => (
  <section id={id} className="mx-auto max-w-5xl px-6 py-20">
    <h2 className="max-w-2xl text-3xl font-black tracking-tight sm:text-4xl">{title}</h2>
    <div className="mt-8">{children}</div>
  </section>
);

export default function Page() {
  return (
    <main>
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <span className="text-xl font-black tracking-tight">Grablight</span>
        <nav className="flex gap-6 text-sm font-medium">
          <a href="#lights" className="hover:underline">The lights</a>
          <a href="#install" className="hover:underline">Install</a>
          <a href="#privacy" className="hover:underline">Privacy</a>
        </nav>
      </header>

      <div className="mx-auto grid max-w-5xl items-center gap-12 px-6 pb-24 pt-12 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <h1 className="text-5xl font-black leading-[0.95] tracking-tight sm:text-7xl">
            See if it will download before you click.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed">
            Grablight finds the files and videos on the page you’re on and downloads them in one click, with no link
            copying. Every file gets a light first, and the toolbar icon shows the light for the whole page.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <a
              href="#install"
              className="rounded-md bg-asphalt px-5 py-3 font-bold text-paper hover:bg-black"
            >
              Install Grablight
            </a>
            <a href="#lights" className="rounded-md border-2 border-asphalt px-5 py-3 font-bold hover:bg-paper">
              How the lights work
            </a>
          </div>
        </div>

        {/* A copy of the real popup, so the page shows the product instead of describing it. */}
        <div className="w-full max-w-sm justify-self-center rounded-xl border-2 border-asphalt bg-paper p-4 lg:justify-self-end">
          <div className="flex items-baseline justify-between">
            <span className="text-lg font-black">Grablight</span>
            <span className="text-xs">4 found</span>
          </div>
          <div className="mt-3 rounded-md bg-go px-3 py-2 text-center text-sm font-bold text-asphalt">
            Download all that can (2)
          </div>
          <ul className="mt-3 space-y-1.5">
            {DEMO.map((f, i) => (
              <li key={f.name} className="flex items-center gap-3 rounded-md bg-concrete px-3 py-2">
                <span
                  className={`light h-3 w-3 shrink-0 rounded-full ${f.color}`}
                  style={{ '--i': i }}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{f.name}</span>
                  <span className="block truncate text-xs">{f.note}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="bg-paper">
        <Section id="lights" title="Three lights, so you know before you click.">
          <div className="relative max-w-2xl">
            {/* The housing behind the discs: one asphalt pill, three lights, like a signal. */}
            <div className="absolute inset-y-0 left-0 w-20 rounded-full bg-asphalt" aria-hidden="true" />
            {LIGHTS.map((l) => (
              <div key={l.title} className="relative grid grid-cols-[5rem_1fr] items-center gap-8 py-7">
                <span className={`mx-auto h-12 w-12 rounded-full ${l.color}`} aria-hidden="true" />
                <div>
                  <h3 className="text-xl font-black">{l.title}</h3>
                  <p className="mt-1 leading-relaxed">{l.text}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section title="What it can grab, and what it won’t.">
        <div className="grid gap-10 sm:grid-cols-2">
          <div>
            <h3 className="text-xl font-black">Grablight can download</h3>
            <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed">
              <li>Files linked on a page: PDFs, documents, archives, audio, video and images.</li>
              <li>Videos that hide inside the page and never show up as a link.</li>
              <li>Video streams (HLS, <code>.m3u8</code>), including streams encrypted with AES-128, joined into one file.</li>
              <li>Full-size images from <code>srcset</code>, lazy-loaded images, and the original upload on Wikimedia.</li>
              <li>GitHub release downloads, even when the file has no extension.</li>
            </ul>
          </div>
          <div>
            <h3 className="text-xl font-black">Grablight won’t download</h3>
            <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed">
              <li>Video or audio from YouTube, Netflix, Prime Video, Disney+, Hotstar and Spotify. You can add more sites in settings.</li>
              <li>Anything protected by DRM.</li>
              <li>Live streams.</li>
              <li>DASH streams (<code>.mpd</code>), for now.</li>
            </ul>
            <p className="mt-4 text-sm leading-relaxed">
              Streams are saved as <code>.ts</code> (or <code>.mp4</code>) exactly as they arrive. VLC and mpv open them.
            </p>
          </div>
        </div>
      </Section>

      <div className="bg-paper">
        <Section id="install" title="Install it in Chrome.">
          <p className="max-w-xl leading-relaxed">
            Grablight isn’t on the Chrome Web Store yet, so you load it yourself. It takes about two minutes and needs
            Node.js 18 or newer.
          </p>
          <ol className="mt-6 max-w-xl list-decimal space-y-4 pl-5 leading-relaxed">
            <li>
              Get the code: <code>git clone https://github.com/Sour16o4/grablight.git</code>
            </li>
            <li>
              In the <code>extension</code> folder, run <code>npm install</code>, then <code>npm run build</code>.
            </li>
            <li>
              Open <code>chrome://extensions</code> and turn on <strong>Developer mode</strong>.
            </li>
            <li>
              Click <strong>Load unpacked</strong> and choose <code>extension/.output/chrome-mv3</code>. The folder starts
              with a dot, so press Ctrl+H in the file picker to see it.
            </li>
            <li>Pin Grablight from the puzzle-piece menu, then open any page and click its icon.</li>
          </ol>
        </Section>
      </div>

      <Section id="privacy" title="What Grablight can see, and where it goes.">
        <ul className="max-w-2xl list-disc space-y-3 pl-5 leading-relaxed">
          <li>
            It reads the pages you open to find files, and watches network responses for video streams. That is why it asks
            for access to all sites. Nothing it finds is sent to us: we have no server.
          </li>
          <li>
            Downloads go straight from the site to your computer. When it checks a file, the request goes to that file’s
            own server, like your browser would.
          </li>
          <li>
            Your settings and download history are stored in this browser only. You can clear the history or reset the
            settings at any time.
          </li>
          <li>There is no account and no analytics.</li>
        </ul>
      </Section>

      <footer className="mx-auto max-w-5xl px-6 pb-12 text-sm">
        Grablight. Only download what you have the right to download.
      </footer>
    </main>
  );
}
