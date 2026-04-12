self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

function resolveNotificationUrl(payload) {
  const destination = String(payload?.destination || 'events').trim()
  const explicitUrl = String(payload?.url || '').trim()
  if (explicitUrl) {
    return explicitUrl
  }

  const url = new URL('/', self.location.origin)
  url.searchParams.set('openTab', destination)
  return url.toString()
}

self.addEventListener('push', (event) => {
  const fallbackPayload = {
    title: 'MalinkiEco',
    body: 'У вас новое уведомление.',
    destination: 'events',
    category: 'events',
  }

  let payload = fallbackPayload
  if (event.data) {
    try {
      payload = { ...fallbackPayload, ...event.data.json() }
    } catch {
      payload = { ...fallbackPayload, body: event.data.text() || fallbackPayload.body }
    }
  }

  const title = String(payload.title || fallbackPayload.title)
  const body = String(payload.body || fallbackPayload.body)
  const destination = String(payload.destination || fallbackPayload.destination)
  const category = String(payload.category || destination)
  const url = resolveNotificationUrl(payload)

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: `malinkieco-${category}`,
      badge: '/pwa-192.png',
      icon: '/pwa-192.png',
      data: {
        url,
        destination,
        category,
      },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = String(event.notification?.data?.url || `${self.location.origin}/`)

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        const windowClient = /** @type {WindowClient} */ (client)
        if ('navigate' in windowClient) {
          await windowClient.navigate(targetUrl)
        }
        await windowClient.focus()
        return
      }
      await self.clients.openWindow(targetUrl)
    }),
  )
})
