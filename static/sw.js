// Service Worker for UK Aurora & Night Sky — lightweight cache strategy
var CACHE_NAME = 'aurora-v20';
var PRECACHE = [
    '/',
    '/static/css/style.css',
    '/static/js/main.js',
];

// Install: pre-cache shell
self.addEventListener('install', function(e) {
    e.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll(PRECACHE);
        })
    );
    self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', function(e) {
    e.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(
                keys.filter(function(k) { return k !== CACHE_NAME; })
                    .map(function(k) { return caches.delete(k); })
            );
        })
    );
    self.clients.claim();
});

// Fetch: network-first for API, cache-first for static assets
self.addEventListener('fetch', function(e) {
    var url = new URL(e.request.url);

    // API calls and NOAA data: always network-first
    if (url.pathname.startsWith('/api/') || url.hostname.includes('swpc.noaa.gov')) {
        e.respondWith(
            fetch(e.request).catch(function() {
                return caches.match(e.request);
            })
        );
        return;
    }

    // Static assets: cache-first with network fallback
    if (url.pathname.startsWith('/static/')) {
        e.respondWith(
            caches.match(e.request).then(function(cached) {
                return cached || fetch(e.request).then(function(resp) {
                    var clone = resp.clone();
                    caches.open(CACHE_NAME).then(function(cache) {
                        cache.put(e.request, clone);
                    });
                    return resp;
                });
            })
        );
        return;
    }

    // Everything else: network-first
    e.respondWith(
        fetch(e.request).then(function(resp) {
            var clone = resp.clone();
            caches.open(CACHE_NAME).then(function(cache) {
                cache.put(e.request, clone);
            });
            return resp;
        }).catch(function() {
            return caches.match(e.request);
        })
    );
});
