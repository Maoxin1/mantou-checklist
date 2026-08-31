const CACHE_NAME = "personal-investment-checklist-v16";
const APP_SHELL = [
  "./",
  "./index.html",
  "./editor.html",
  "./styles.css?v=16",
  "./editor.css?v=16",
  "./app.js?v=16",
  "./editor.js?v=16",
  "./config.json",
  "./manifest.webmanifest",
  "./editor.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192.svg",
  "./icons/icon-512.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith(networkFirst(event.request));
});

async function networkFirst(request) {
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const pathname = new URL(request.url).pathname;
      const isEditor = /\/editor(?:\.html)?\/?$/.test(pathname);
      return isEditor ? caches.match("./editor.html") : caches.match("./index.html");
    }
    throw new Error(`Offline resource unavailable: ${request.url}`);
  }
}
