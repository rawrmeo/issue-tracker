/* ============================================================================
 *  sw.js  —  service worker
 * ----------------------------------------------------------------------------
 *  Two jobs:
 *    1. It is what makes the app installable ("Add to Home Screen").
 *    2. It keeps the app shell available offline.
 *
 *  It deliberately never touches requests to Supabase: only same-origin GETs
 *  are cached, so sign-in, issues and every other API call go straight to the
 *  network and are never served stale.
 * ========================================================================= */

var CACHE = "issue-tracker-v1";

var SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
                                .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;

  if (request.method !== "GET") return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // never cache Supabase

  // Network first, so a new deploy is picked up on the next load. The cache is
  // only a fallback for when there is no network at all.
  event.respondWith(
    fetch(request)
      .then(function (response) {
        var copy = response.clone();
        caches.open(CACHE).then(function (cache) { cache.put(request, copy); }).catch(function () {});
        return response;
      })
      .catch(function () {
        return caches.match(request).then(function (hit) {
          return hit || caches.match("./index.html");
        });
      })
  );
});
