// Aumentamos la versión a v3 para forzar a los celulares a borrar el caché viejo
const CACHE_NAME = 'gymlytics-v3';
const urlsToCache = [
    '/',
    '/index.html',
    '/style.css',
    '/scripts.js',
    '/scripts2.js',
    '/manifest.json'
];

// 1. Instalación e Inyección Inmediata
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
    );
    self.skipWaiting(); // Obliga al celular a usar esta nueva versión sin esperar
});

// 2. Limpieza profunda
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName); // Borra el CSS roto anterior
                    }
                })
            );
        })
    );
    self.clients.claim(); // Toma el control de la pantalla de inmediato
});

// 3. LA MAGIA: Stale-While-Revalidate (Caché instantáneo + Red de fondo)
self.addEventListener('fetch', event => {
    // La base de datos (API) siempre requiere internet fresco, la ignoramos aquí
    if (event.request.url.includes('/api/')) {
        return; 
    }

    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            // Se dispara la búsqueda en internet de forma silenciosa
            const fetchPromise = fetch(event.request).then(networkResponse => {
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, networkResponse.clone());
                });
                return networkResponse;
            }).catch(() => {
                // Si el usuario está sin señal en el gimnasio, no hacemos nada
            });

            return cachedResponse || fetchPromise; 
        })
    );
});