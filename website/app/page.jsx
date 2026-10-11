// Single-page site for the Grablight extension. Frosted glass over soft sage light, with the product
// shown as a working demo. Every claim is checked against the extension's code
// (extension/utils/*.js, wxt.config.js, README.md).
import ScanDemo from './components/ScanDemo';
import Recording from './components/Recording';

const RECORDINGS = [
  {
    n: 1,
    file: '/demo/course-pdf.mp4',
    title: 'A PDF on a course page',
    text: "Grablight scans the page and checks each file with its own server, so the light is ready before you click. One click, and Chrome saves it.",
    result: 'Green, downloaded',
    tone: 'bg-gradient-to-br from-sage to-bg',
  },
  {
    n: 2,
    file: '/demo/hidden-stream.mp4',
    title: 'A video the page never links',
    text: 'It spots the stream by watching network responses, reads the playlist, and joins the pieces into one file with live progress.',
    result: 'Green, one file saved',
    tone: 'bg-gradient-to-br from-bg to-sage',
  },
  {
    n: 3,
    file: '/demo/blocked-site.mp4',
    title: 'A site that says no',
    text: 'The site is on the block list, so the light is red with the reason and the Download button is disabled. Nothing starts.',
    result: 'Red, refused with the reason',
    refused: true,
    tone: 'bg-gradient-to-br from-sage to-olive/40',
  },
];

const PRIVACY = [
  ['Nothing is sent to us', 'Grablight reads the pages you open and watches network responses for video streams. That is why it asks for access to all sites. We have no server.'],
  ['Downloads go straight to you', "From the site to your computer. Checking a file sends a request to that file's own server, like your browser would."],
  ['Your data stays in the browser', 'Settings and download history are stored in this browser only. Clear the history or reset the settings at any time.'],
  ['No account, no analytics', 'There is nothing to sign up for and nothing counting you.'],
];

export default function Page() {
  return (
    <main className="relative overflow-hidden">
      {/* Soft light behind the glass. Transform-only drift; still under reduced motion. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[1100px]">
        <div className="drift-a absolute -left-32 -top-24 h-[640px] w-[640px] rounded-full bg-sage opacity-75 blur-[90px]" />
        <div className="drift-b absolute -right-40 top-10 h-[700px] w-[700px] rounded-full bg-sage opacity-60 blur-[110px]" />
        <div className="drift-a absolute right-60 top-[420px] h-[380px] w-[380px] rounded-full bg-olive opacity-25 blur-[120px]" />
      </div>

      <div className="relative">
        <header className="mx-auto grid h-[72px] max-w-7xl grid-cols-[1fr_auto_1fr] items-center px-6">
          <a href="#top" className="wordmark text-xl font-semibold">Grablight</a>
          <nav className="glass hidden items-center gap-7 !rounded-full px-6 py-3 text-xs font-medium uppercase tracking-[0.08em] md:flex">
            <a href="#watch" className="hover:underline">Recordings</a>
            <a href="#lights" className="hover:underline">The lights</a>
            <a href="#install" className="hover:underline">Install</a>
            <a href="#privacy" className="hover:underline">Privacy</a>
          </nav>
          <span aria-hidden="true" />
        </header>

        <section id="top" className="mx-auto grid max-w-7xl items-center gap-14 px-6 pb-24 pt-12 lg:grid-cols-[1.15fr_1fr] lg:pt-16">
          <div>
            <h1 className="max-w-[18ch] text-4xl font-semibold leading-[1.08] sm:text-5xl lg:text-[56px]">
              Downloads, without the guessing.
            </h1>
            <p className="mt-6 max-w-[40ch] text-lg leading-relaxed text-dim">
              Grablight tells you which files on a page will download, before you click.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <a href="#watch" className="btn btn-glass">Watch it work</a>
            </div>
          </div>

          <div className="relative">
            <ScanDemo />
          </div>
        </section>

        <section id="lights" className="mx-auto max-w-7xl px-6 pb-28">
          <h2 className="max-w-xl text-4xl font-semibold leading-[1.05] tracking-tighter md:text-5xl">
            Every file gets a light first.
          </h2>
          <div className="mt-12 grid gap-5 md:grid-cols-3 md:grid-rows-2">
            <div className="glass flex flex-col justify-between p-8 md:col-span-2 md:row-span-2 md:p-10">
              <div>
                <div className="flex items-center gap-3"><i className="lens lens-green" /><span className="font-mono text-xs text-dim">Green</span></div>
                <h3 className="mt-5 text-4xl font-semibold leading-none tracking-tighter md:text-5xl">It will download.</h3>
                <p className="mt-5 max-w-[46ch] text-lg leading-relaxed text-dim">
                  The file answered, it is a real file, and nothing blocks it. One click saves it, and the toolbar badge shows the best light on the page with the file count.
                </p>
              </div>
              <a href="#watch" className="mt-10 text-sm font-semibold underline underline-offset-4">See it happen in the recordings</a>
            </div>
            <div className="glass p-7">
              <div className="flex items-center gap-3"><i className="lens lens-amber" /><span className="font-mono text-xs text-dim">Yellow</span></div>
              <h3 className="mt-4 text-2xl font-semibold tracking-tight">It may fail.</h3>
              <p className="mt-2 leading-relaxed text-dim">Grablight couldn't fully check it, for example because the server refuses preview requests. You can still try.</p>
            </div>
            <div className="glass p-7">
              <div className="flex items-center gap-3"><i className="lens lens-red" /><span className="font-mono text-xs text-dim">Red</span></div>
              <h3 className="mt-4 text-2xl font-semibold tracking-tight">It can't download.</h3>
              <p className="mt-2 leading-relaxed text-dim">The reason is shown next to the file: the site doesn't allow it, it needs a login, it is a live stream, or it is protected by DRM.</p>
            </div>
          </div>
        </section>

        <section id="watch" className="pb-28">
          <div className="mx-auto max-w-7xl px-6">
            <h2 className="max-w-2xl text-4xl font-semibold leading-[1.05] tracking-tighter md:text-5xl">
              Three scenarios, recorded with the real extension.
            </h2>
            <p className="mt-4 max-w-[60ch] leading-relaxed text-dim">
              Each clip shows the page on the left and the Grablight popup on the right, from the first scan to the result. The pages are local test pages, and the extension is the build from this repository.
            </p>
          </div>
          <div className="mx-auto mt-12 flex max-w-7xl flex-col gap-8 px-6">
            {RECORDINGS.map((r) => (
              <Recording key={r.n} {...r} />
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-6 pb-28">
          <h2 className="max-w-2xl text-4xl font-semibold leading-[1.05] tracking-tighter md:text-5xl">
            What it grabs, and what it won’t.
          </h2>
          <div className="mt-12 grid gap-16 md:grid-cols-2">
            <div>
              <h3 className="text-xl font-semibold tracking-tight">Grablight can download</h3>
              <ul className="mt-4 max-w-[56ch] list-disc space-y-3 pl-5 leading-relaxed text-dim">
                <li>Files linked on a page: PDFs, documents, archives, audio, video and images.</li>
                <li>Videos the page never links, found by watching network responses.</li>
                <li>Video streams (HLS, <code className="font-mono text-[0.9em]">.m3u8</code>), including AES-128 encryption, joined into one file.</li>
                <li>Full-size images from <code className="font-mono text-[0.9em]">srcset</code>, lazy-loaded images, and the original upload on Wikimedia.</li>
                <li>GitHub release downloads, even when the file has no extension.</li>
              </ul>
            </div>
            <div>
              <h3 className="text-xl font-semibold tracking-tight">Grablight won’t download</h3>
              <ul className="mt-4 max-w-[56ch] list-disc space-y-3 pl-5 leading-relaxed text-dim">
                <li>Video or audio from YouTube, Netflix, Prime Video, Disney+, Hotstar and Spotify. You can add more sites in Settings.</li>
                <li>Anything protected by DRM, and live streams.</li>
                <li>DASH streams (<code className="font-mono text-[0.9em]">.mpd</code>) and byte-range playlists, for now.</li>
              </ul>
              <p className="mt-6 max-w-[56ch] text-sm leading-relaxed text-dim">
                Streams are joined in memory (up to 1.5 GB) and saved as <code className="font-mono">.ts</code> or <code className="font-mono">.mp4</code> exactly as they arrive. VLC and mpv open them. A stream with a separate audio track gives video only.
              </p>
            </div>
          </div>
        </section>

        <section id="install" className="mx-auto max-w-7xl px-6 pb-28">
          <div className="glass grid gap-12 p-8 md:p-12 lg:grid-cols-[1fr_1.3fr]">
            <div>
              <h2 className="text-4xl font-semibold leading-[1.05] tracking-tighter md:text-5xl">Install it in Chrome.</h2>
              <p className="mt-4 max-w-[40ch] leading-relaxed text-dim">
                Grablight isn’t on the Chrome Web Store yet, so you load it yourself. It needs Chrome 116 or newer and Node.js 20.19 or newer.
              </p>
            </div>
            <div>
              <pre className="overflow-x-auto rounded-[16px] bg-olive p-6 font-mono text-sm leading-8 text-bg">
{`git clone https://github.com/Sour16o4/grablight.git
cd grablight/extension
npm install
npm run build`}
              </pre>
              <ol className="mt-8 list-decimal space-y-3 pl-5 leading-relaxed">
                <li>Open <code className="font-mono text-[0.9em]">chrome://extensions</code> and turn on <strong>Developer mode</strong>.</li>
                <li>Click <strong>Load unpacked</strong> and choose <code className="font-mono text-[0.9em]">extension/.output/chrome-mv3</code>. The folder starts with a dot, so press Ctrl+H in the file picker to see it.</li>
                <li>Pin Grablight from the puzzle-piece menu, then open any page and click its icon.</li>
              </ol>
            </div>
          </div>
        </section>

        <section id="privacy" className="mx-auto max-w-7xl px-6 pb-28">
          <h2 className="max-w-2xl text-4xl font-semibold leading-[1.05] tracking-tighter md:text-5xl">
            What Grablight can see, and where it goes.
          </h2>
          <div className="mt-12 grid gap-x-16 gap-y-10 md:grid-cols-2">
            {PRIVACY.map(([t, d]) => (
              <div key={t} className="border-t border-line pt-5">
                <h3 className="text-lg font-semibold tracking-tight">{t}</h3>
                <p className="mt-2 max-w-[52ch] leading-relaxed text-dim">{d}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="relative rounded-t-[48px] bg-olive px-6 pb-10 pt-24 text-bg">
        <div className="mx-auto max-w-7xl">
          <h2 className="max-w-3xl text-5xl font-semibold leading-[1] tracking-tighter md:text-7xl">Check first. Then grab.</h2>
          <a href="#install" className="btn mt-10 bg-sage text-olive">Get the code</a>
          <p className="mt-24 flex flex-wrap justify-between gap-3 text-sm text-sage">
            <span>Grablight. Only download what you have the right to download.</span>
            <a href="#privacy" className="underline underline-offset-4">Privacy</a>
          </p>
        </div>
      </section>
    </main>
  );
}
