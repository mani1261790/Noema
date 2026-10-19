/* Only the static offline screen is cached. Never persist articles, API responses,
   preview pages, credentials, or assistant conversations. Bump when offline UI changes. */
const CACHE = "noema-offline-v1";
const OFFLINE = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE)));
  // Let existing tabs finish with their current worker; activate on the next visit.
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("noema-offline-") && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (/^\/(api|preview|studio|admin|auth)(\/|$)/.test(url.pathname)) return;
  event.respondWith((async () => {
    try {
      // Preserve real HTTP errors, redirects and freshness. Only a network failure
      // displays the fallback, without caching the requested page.
      return await fetch(request);
    } catch {
      return (await caches.match(OFFLINE, { cacheName: CACHE })) ?? Response.error();
    }
  })());
});
