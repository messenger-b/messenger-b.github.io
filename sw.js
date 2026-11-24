const CACHE_NAME = 'messenger-b-cloud-v14';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request, { cache: 'no-store' })
      .then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, clone));
        }
        return res;
      })
      .catch(() => caches.match(request).then((c) => c || caches.match('/index.html')))
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const chatId = event.notification.data?.chatId;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          if (chatId) client.postMessage({ type: 'OPEN_CHAT', chatId });
          return;
        }
      }
      const target = chatId ? `/?openChat=${encodeURIComponent(chatId)}` : '/';
      return self.clients.openWindow(target);
    })
  );
});

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload = {};
    try { payload = event.data ? event.data.json() : {}; }
    catch { payload = { body: event.data?.text?.() || 'Новое сообщение' }; }

    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const isVisible = clients.some((c) => c.visibilityState === 'visible' || c.focused);
    if (!payload.test && isVisible) return;

    const title = payload.title || 'Мессенджер Б';
    const uniqueTag = `${payload.tag || (payload.chatId ? `chat-${payload.chatId}` : 'messenger-b')}-${Date.now()}`;
    const options = {
      body: payload.body || 'Новое сообщение',
      icon: '/icons/icon.svg',
      badge: '/icons/icon.svg',
      tag: uniqueTag,
      renotify: true,
      data: { chatId: payload.chatId || null },
    };
    await self.registration.showNotification(title, options);
  })());
});