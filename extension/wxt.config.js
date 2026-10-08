// WXT reads this file to build the extension.
// It generates manifest.json for you from the settings below,
// so you never edit a manifest file by hand.
import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Lets WXT understand React files (.jsx).
  modules: ['@wxt-dev/module-react'],

  // Everything here ends up in the generated manifest.json.
  manifest: {
    name: 'Grablight',
    description: "Find and download the files and videos on the page you're on.",
    // offscreen documents, runtime.getContexts and AbortSignal.any all arrive in Chrome 116.
    minimum_chrome_version: '116',
    // Why each permission is needed:
    //  scripting + host_permissions: read any page to find its files, so every tab gets its light
    //  webRequest: watch network responses for video streams the page never lists
    //  downloads: save files and list/stop/delete them in the popup
    //  storage: settings, download history, per-tab file lists
    //  offscreen: a hidden page that joins stream pieces into one file
    permissions: ['scripting', 'downloads', 'webRequest', 'storage', 'offscreen'],
    host_permissions: ['<all_urls>'],
  },

  // Turns on Tailwind CSS for every page in the extension.
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
