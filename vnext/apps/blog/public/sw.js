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

// Notification payloads never control a cross-origin navigation.
function notificationUrl(value) {
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin === self.location.origin && /^\/articles\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(url.pathname)) {
      return self.location.origin + url.pathname;
    }
  } catch { /* use the updates page for an invalid payload */ }
  return self.location.origin + "/updates";
}
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { /* show a visible fallback */ }
  if (!data || typeof data !== "object") data = {};
  event.waitUntil(self.registration.showNotification(typeof data.title === "string" ? data.title.slice(0, 120) : "Noemaの新着記事", {
    body: typeof data.body === "string" ? data.body.slice(0, 160) : "新しい記事が公開されました。",
    icon: "/icons/v2/icon-192.png",
    badge: "/icons/v2/icon-192.png",
    tag: typeof data.tag === "string" ? data.tag.slice(0, 120) : "noema-new-article",
    data: { url: notificationUrl(data.url) },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = notificationUrl(event.notification.data?.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type:"window", includeUncontrolled:true});
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && "navigate" in client) {
        const opened = await client.navigate(url);
        if (opened) return opened.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_PUSH") event.waitUntil(self.skipWaiting());
});
