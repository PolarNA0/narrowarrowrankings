/**
 * Service worker for Narrow Arrow Rankings.
 *
 * The goal is offline capability for the parts that are actually self-contained:
 * the Play tab and replay viewing run entirely off the bundled Rust physics
 * WASM, so once that and the app shell are cached they work with no network.
 *
 * Strategy, per request kind:
 *   - navigations: network-first, falling back to the cached shell. Deploys are
 *     live on every push with no CI, so a cache-first shell would serve a stale
 *     app until the version bump; network-first means a connected client always
 *     gets the current build, and only an offline client falls back.
 *   - hashed build assets (/_build/*, the bundled /assets/*): cache-first. The
 *     filename changes with the content, so a hit is always correct.
 *   - the physics WASM and the icons: cache-first (large, immutable).
 *   - /api/*: never cached. Leaderboards are live data, and the proxied
 *     upstream responses already carry their own cache headers.
 *
 * Bump CACHE_VERSION to retire every old cache on activate.
 */
const CACHE_VERSION = "na-rankings-v2";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;

/** Immutable, self-contained assets worth pre-caching for offline Play. */
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(ASSET_CACHE);
      // Individually, so one 404 (e.g. a renamed icon) cannot fail the whole
      // install and leave the app with no service worker at all.
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => undefined),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => !key.startsWith(CACHE_VERSION)).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

/** A build asset: content-hashed, so a cached copy is always the right one. */
function isImmutableAsset(url) {
  return (
    url.pathname.startsWith("/_build/") ||
    url.pathname.startsWith("/assets/") ||
    url.pathname.endsWith(".wasm") ||
    url.pathname.startsWith("/icons/")
  );
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") cache.put(request, response.clone());
  return response;
}

async function networkFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") cache.put(request, response.clone());
    return response;
  } catch {
    // Offline: serve this exact page if it was cached, else the cached shell.
    const hit = (await cache.match(request)) ?? (await cache.match("/"));
    if (hit) return hit;
    return new Response("Offline and no cached copy of this page.", {
      status: 503,
      headers: { "content-type": "text/plain" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Only same-origin traffic: upstream leaderboards, skins and fonts are live
  // and must never be answered from here.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstShell(request));
    return;
  }
  if (isImmutableAsset(url)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
  }
});
