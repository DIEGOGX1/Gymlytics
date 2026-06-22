const CACHE_NAME = 'gymlytics-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/manifest.json'
];

// 1. Instalación: Guardamos la estructura básica
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
    );
});

// 2. Activación: Limpiamos cachés viejas si actualizas la versión
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

// 3. Intercepción: Red primero, Caché como plan B
self.addEventListener('fetch', event => {
    // Excluimos las peticiones a la API para no congelar datos dinámicos
    if (event.request.url.includes('/api/')) {
        return; 
    }

    event.respondWith(
        fetch(event.request)
            .then(response => {
                // Si hay internet, clonamos la respuesta fresca a la caché
                const resClone = response.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, resClone);
                });
                return response;
            })
            .catch(() => {
                // Si no hay internet, mostramos la interfaz guardada
                return caches.match(event.request);
            })
    );
});