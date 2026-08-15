const CACHE_PREFIX = "chooser-";
const CACHE_NAME = `${CACHE_PREFIX}v20`;
const APP_BASE = new URL("./", self.location.href);
const CACHE_PATHS = [
	"./",
	"index.css",
	"index.js",
	"room.js",
	"vendor/trystero-nostr-0.25.3.js",
	"prompts.js",
	"prompts-content.js",
	"favicon.ico",
	"manifest.webmanifest",
	"images/logo-16.png",
	"images/logo-32.png",
	"images/logo-48.png",
	"images/logo-96.png",
	"images/logo-144.png",
	"images/logo-192.png",
	"images/logo-192-opaque.png",
	"images/logo-384.png",
	"images/logo-maskable-48.png",
	"images/logo-maskable-96.png",
	"images/logo-maskable-144.png",
	"images/logo-maskable-192.png",
	"images/logo-maskable-384.png",
];
const CACHE_URLS = CACHE_PATHS.map((path) => new URL(path, APP_BASE).href);

self.addEventListener("install", (event) => {
	self.skipWaiting();
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => cache.addAll(CACHE_URLS)),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		Promise.all([
			caches.keys().then((cacheNames) =>
				Promise.all(
					cacheNames
						.filter(
							(cacheName) =>
								cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME,
						)
						.map((cacheName) => caches.delete(cacheName)),
				),
			),
			self.clients.claim(),
		]),
	);
});

self.addEventListener("fetch", (event) => {
	if (event.request.method !== "GET") return;
	const requestUrl = new URL(event.request.url);
	if (requestUrl.origin !== self.location.origin) return;

	event.respondWith(
		caches.match(event.request).then((cachedResponse) => {
			if (cachedResponse) return cachedResponse;
			return fetch(event.request).catch(() => {
				if (event.request.mode === "navigate") {
					return caches.match(new URL("./", APP_BASE).href);
				}
				throw new Error("Resource is unavailable offline.");
			});
		}),
	);
});

self.addEventListener("message", (event) => {
	if (event.data === "version") {
		event.source?.postMessage({ version: CACHE_NAME });
	}
});
