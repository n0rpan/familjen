// Familjen Service Worker
// Handles PWA installation, push notifications, and asset caching
// Uses stale-while-revalidate for fast repeat visits while ensuring fresh data

const CACHE_NAME = 'familjen-v4'
const STATIC_CACHE = 'familjen-static-v3'
const NAV_CACHE = 'familjen-nav-v1'

// Max age for cached navigation responses (5 minutes)
// After this, we'll still show cached but prioritize network
const NAV_CACHE_MAX_AGE = 5 * 60 * 1000

// Static assets to cache immediately on install
const STATIC_ASSETS = [
  '/icons/icon.svg',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/manifest.json',
]

// Install event - cache essential files
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...')
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] Caching static assets')
      return cache.addAll(STATIC_ASSETS)
    })
  )
  // Skip waiting to activate immediately
  self.skipWaiting()
})

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...')
  const currentCaches = [CACHE_NAME, STATIC_CACHE, NAV_CACHE]
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => !currentCaches.includes(name))
          .map((name) => {
            console.log('[SW] Deleting old cache:', name)
            return caches.delete(name)
          })
      )
    })
  )
  // Take control of all pages immediately
  self.clients.claim()
})

// Fetch event - cache-first for static assets, network-first for API
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET requests
  if (request.method !== 'GET') return

  // Skip API calls, auth, and RSC requests - always go to network
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.searchParams.has('_rsc')  // Next.js React Server Components
  ) {
    return
  }

  // For static assets (JS, CSS, images, fonts) - stale-while-revalidate
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.woff') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.ico')
  ) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) => {
        return cache.match(request).then((cachedResponse) => {
          const fetchPromise = fetch(request).then((networkResponse) => {
            if (networkResponse.ok) {
              cache.put(request, networkResponse.clone())
            }
            return networkResponse
          }).catch(() => cachedResponse)

          // Return cached response immediately, update cache in background
          return cachedResponse || fetchPromise
        })
      })
    )
    return
  }

  // For navigation requests - stale-while-revalidate for instant repeat visits
  // Always fetches fresh in background to ensure data is never truly stale
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(NAV_CACHE)
        const cachedResponse = await cache.match(request)

        // Start network fetch immediately (don't wait for cache check)
        const networkPromise = fetch(request)
          .then(async (response) => {
            if (response.ok) {
              // Store response with timestamp for freshness checking
              const responseToCache = response.clone()
              const headers = new Headers(responseToCache.headers)
              headers.set('sw-cache-time', Date.now().toString())

              const body = await responseToCache.blob()
              const cachedResponse = new Response(body, {
                status: responseToCache.status,
                statusText: responseToCache.statusText,
                headers: headers
              })

              await cache.put(request, cachedResponse)
            }
            return response
          })
          .catch((error) => {
            console.log('[SW] Network fetch failed:', error)
            return null
          })

        // If we have a cached response, check its age
        if (cachedResponse) {
          const cacheTime = cachedResponse.headers.get('sw-cache-time')
          const age = cacheTime ? Date.now() - parseInt(cacheTime, 10) : Infinity

          if (age < NAV_CACHE_MAX_AGE) {
            // Cache is fresh - serve immediately, update in background
            console.log('[SW] Serving fresh cache for:', request.url)
            networkPromise // Let it run in background
            return cachedResponse
          } else {
            // Cache is stale - try to get network response first
            // but if network is slow (>1s), serve stale cache
            console.log('[SW] Cache stale, racing network for:', request.url)
            const timeoutPromise = new Promise((resolve) => {
              setTimeout(() => resolve(cachedResponse), 1000)
            })

            const result = await Promise.race([networkPromise, timeoutPromise])
            return result || cachedResponse
          }
        }

        // No cache - wait for network, fallback to root page cache for offline
        const networkResponse = await networkPromise
        if (networkResponse) {
          return networkResponse
        }

        // Completely offline and no cache - try root page
        const rootCache = await cache.match('/')
        return rootCache || new Response('Offline', { status: 503 })
      })()
    )
    return
  }
})

// Push notification event
self.addEventListener('push', (event) => {
  console.log('[SW] Push received:', event)

  let data = { title: 'Familjen', body: 'Du har en ny varsling' }

  if (event.data) {
    try {
      data = event.data.json()
    } catch (e) {
      data.body = event.data.text()
    }
  }

  const options = {
    body: data.body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/',
      dateOfArrival: Date.now(),
    },
    actions: data.actions || [],
    tag: data.tag || 'familjen-notification',
    renotify: true,
  }

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  )
})

// Notification click event
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event)

  event.notification.close()

  const urlToOpen = event.notification.data?.url || '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Check if there's already a window open
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus()
          if (urlToOpen !== '/') {
            client.navigate(urlToOpen)
          }
          return
        }
      }
      // Open new window if none found
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen)
      }
    })
  )
})

// Handle notification close
self.addEventListener('notificationclose', (event) => {
  console.log('[SW] Notification closed:', event)
})

// Handle messages from client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Skip waiting requested')
    self.skipWaiting()
  }

  // Allow clients to clear navigation cache (e.g., on pull-to-refresh)
  if (event.data && event.data.type === 'CLEAR_NAV_CACHE') {
    console.log('[SW] Clearing navigation cache')
    caches.delete(NAV_CACHE).then(() => {
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ success: true })
      }
    })
  }

  // Allow clients to check if content was served from cache
  if (event.data && event.data.type === 'GET_CACHE_STATUS') {
    const url = event.data.url
    caches.open(NAV_CACHE).then(async (cache) => {
      const cached = await cache.match(url)
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({
          cached: !!cached,
          cacheTime: cached?.headers.get('sw-cache-time')
        })
      }
    })
  }
})
