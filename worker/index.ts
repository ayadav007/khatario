/// <reference lib="webworker" />

/**
 * Bundled into public/sw.js by @ducanh2912/next-pwa so FCM can wake a
 * root-scoped worker after the admin WebAPK is swiped away.
 */
declare const self: ServiceWorkerGlobalScope;

function parsePushPayload(event: PushEvent): { title: string; body: string; url: string } {
  const fallback = { title: 'Khatario Admin', body: 'New notification', url: '/admin' };
  try {
    if (event.data) return { ...fallback, ...event.data.json() };
  } catch {
    try {
      fallback.body = event.data ? event.data.text() : fallback.body;
    } catch {
      /* ignore */
    }
  }
  return fallback;
}

self.addEventListener('push', (event) => {
  const data = parsePushPayload(event);
  event.waitUntil(
    self.registration.showNotification(data.title || 'Khatario Admin', {
      body: data.body || 'New notification',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/admin' },
      tag: data.url?.startsWith('/admin') ? 'khatario-admin' : 'khatario',
      renotify: true,
      silent: false,
      vibrate: [200, 100, 200],
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/admin';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url.split('?')[0]) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    }),
  );
});
