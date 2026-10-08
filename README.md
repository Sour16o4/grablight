# Grablight

A Chrome extension that finds the files and videos on the page you're on and downloads them in one click, without copying links.

Before you click, every file gets a light: green means it will download, yellow means it may fail, and red means it can't (with the reason). The toolbar icon shows the same light for the whole page.

## Folders

- `extension/` — the extension (WXT + React + Tailwind, plain JavaScript)
- `website/` — the companion Next.js site (`cd website && npm install && npm run dev`, opens at http://localhost:3001)

## Run it locally

Requires Node.js 18 or newer.

```bash
cd extension
npm install
npm run dev
```

`npm run dev` opens a separate Chrome window with Grablight already loaded. Edit any file and the extension reloads on its own.

To load it in your normal Chrome instead:

```bash
npm run build
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick `extension/.output/chrome-mv3`.

## Status

- [x] Phase 1: project setup, popup and background script
- [x] Phase 2: page scanning
- [x] Phase 3: one-click download
- [x] Phase 4: network sniffing, headers, block list, status badge
- [x] Phase 5: buttons over videos
- [x] Phase 6: HLS streams with encryption
- [x] Phase 7: site adapters (`extension/utils/scan.js`: add a site by adding one object to `ADAPTERS`)
- [x] Phase 8: history, settings and website
