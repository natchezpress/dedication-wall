// Morning notes for the Dedication Wall. This file only shows notifications and opens the page you tap;
// it caches nothing and never touches how pages load.
const b64uBytes = (s) => {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  return Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
};
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
  const opts = { body: d.body || '', icon: '/icons/icon-192.png?v=2', badge: '/icons/badge-96.png', tag: d.tag || 'wall', data: { url: d.url || '/wall' } };
  if (d.image) opts.image = d.image;
  event.waitUntil(self.registration.showNotification(d.title || 'Every Dog Deserves a Dedication', opts));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/wall', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
        try { await w.navigate(url); } catch (e) { /* some browsers won't navigate; focusing still helps */ }
        return w.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
// When a browser rolls a phone's push address, sign up again so the morning note keeps arriving.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const { key } = await (await fetch('/api/push/key')).json();
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(key) });
    await fetch('/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub) });
  })());
});
