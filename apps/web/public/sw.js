// Oxygen service worker: the app works offline after the first visit. Pages are network-first (fresh
// deploys win), everything else is cache-first.
const CACHE = 'oxygen-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
	const req = e.request;
	if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
	// the app asking whether a newer version is deployed: only the network knows
	if (req.cache === 'no-store') return;
	const page = req.mode === 'navigate';
	e.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			if (page) {
				try {
					const fresh = await fetch(req);
					cache.put(req, fresh.clone());
					return fresh;
				} catch {
					return (await cache.match(req)) ?? Response.error();
				}
			}
			const hit = await cache.match(req);
			if (hit) return hit;
			const res = await fetch(req);
			if (res.ok) cache.put(req, res.clone());
			return res;
		})(),
	);
});
