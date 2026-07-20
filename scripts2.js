        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js')
                    .then(reg => console.log('🦅 Service Worker registrado con éxito.', reg.scope))
                    .catch(err => console.error('Error al registrar Service Worker:', err));
            });
        }