/* FeonixLLM — minimal service worker, just enough for PWA installability.
   No offline caching of API calls (Ollama/cloud providers need network anyway) —
   this only lets the browser install the app and control the page shell. */
const CACHE = 'feonix-shell-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

/* pass-through fetch — required for the app to be considered "installable"
   by Chrome/Edge, but we don't intercept or cache anything so live data
   (Ollama, cloud APIs) always goes straight to the network */
self.addEventListener('fetch', e => {
  // no-op: let the browser handle it natively
});
