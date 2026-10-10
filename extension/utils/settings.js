// User settings, kept on this computer (storage.local, never synced or sent anywhere).
// Used by the settings page, the background script and the on-video button.
export const DEFAULTS = {
  showVideoButton: true, // the Download button that appears over videos
  blockedSites: '', // extra sites to refuse video/audio from, see parseBlocked in light.js
  // Stream quality: 'ask' (the popup shows a picker), 'best' (best that fits in memory), or a height like '720'.
  // The button over videos has no room for a picker, so for 'ask' it uses 'best'.
  streamQuality: 'ask',
};

export const getSettings = () => browser.storage.local.get(DEFAULTS);

// Download history: newest first, capped so it can't grow forever.
export const HISTORY_LIMIT = 200;

// One at a time: "Download all" finishes several files at once, and two read-then-write
// updates running together would overwrite each other and lose entries.
let queue = Promise.resolve();
export const addHistory = (entry) =>
  (queue = queue.then(async () => {
    const { history = [] } = await browser.storage.local.get('history');
    await browser.storage.local.set({ history: [entry, ...history].slice(0, HISTORY_LIMIT) });
  }));
