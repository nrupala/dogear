// SPDX-FileCopyrightText: 2026 2351485 ALBERTA INC.
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/* DogEar service worker — offline app shell.
   Precaches the shell (pages, code, icons) at install. Documents the
   user adds live in localStorage, not in this cache, and are never
   fetched over the network. /api/import is never cached.

   The voice models live in their OWN cache (PACK_CACHE below, the
   same name as DogEarConfig.VOICE_PACK_CACHE): the app fills it
   through explicit, checksum-verified in-app downloads and empties
   it from the same place, per model. This worker only SERVES
   /pack/ from that cache — it never writes pack files anywhere.
   Activation keeps ONLY the current shell cache and the current
   (v2) pack cache: the v1 pack cache is a superseded format and
   is deleted on upgrade — the picker offers the one-time
   re-download.

   The shell cache name is NOT hand-versioned: build.py replaces
   the eba76bdab50a placeholder below with a short hash of the
   built shell assets, so every build self-invalidates the
   previous shell cache and an identical build reproduces the
   identical name. (Hand-versioning stranded installed browsers
   on a stale engine on 2026-11-07: the shell is cache-first, so
   an unchanged cache name meant the old /reader-core.js kept
   being served after a fix deployed.) The pack cache name is
   deliberately NOT stamped — voice packs are checksum-managed
   under their own name and must survive shell updates. */
var CACHE = 'dogear-app-shell-eba76bdab50a';
var PACK_CACHE = 'dogear-voicepack-v2';
var PACK_PREFIX = '/pack/';
var SHELL = [
  '/',
  '/privacy',
  '/releases',
  '/app.css',
  '/app.js',
  '/config.js',
  '/meter.js',
  '/billing.js',
  '/licence.js',
  '/ingest.js',
  '/retrieval.js',
  '/voicepack.js',
  '/voicefx.js',
  '/ttspack.js',
  '/speaker.js',
  '/selfmodel.js',
  '/vendor/nacl.min.js',
  '/vendor/mammoth.browser.min.js',
  '/vendor/jszip.min.js',
  '/vendor/pdf.min.mjs',
  '/vendor/pdf.worker.min.mjs',
  '/reader-core.js',
  '/reader-core.css',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return (k === CACHE || k === PACK_CACHE) ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return; // imports (POST) always hit the network
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api/') === 0) return; // never cache imports
  if (url.pathname.indexOf(PACK_PREFIX) === 0) {
    // Voice pack: serve the copy the in-app download verified and
    // kept; everything else goes to the network untouched (the
    // pack manifest, and pack files before any download). Nothing
    // here is written to any cache by the worker.
    e.respondWith(
      caches.open(PACK_CACHE).then(function (c) { return c.match(req); })
        .then(function (hit) { return hit || fetch(req); })
    );
    return;
  }
  if (req.mode === 'navigate') {
    // Pages: network first, fall back to the cached shell offline.
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('/');
        });
      })
    );
    return;
  }
  // Static shell assets: cache first, refresh in the background.
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
