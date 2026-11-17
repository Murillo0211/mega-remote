/* Mega Remote service worker: shows the alerts Mega Relay sends to this phone (Web Push), and opens
 * the app when one is tapped. It caches nothing - the page always comes fresh from your PC. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let m = {}; try { m = e.data ? e.data.json() : {}; } catch { m = { title: 'Mega', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'Mega', { body: m.body || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: m.tag || undefined, data: { url: m.url || './' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow(e.notification.data?.url || './');
  })());
});
