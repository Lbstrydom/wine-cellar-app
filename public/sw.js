/**
 * @fileoverview Service Worker for Wine Cellar PWA.
 * Implements caching strategies for offline functionality.
 */

const CACHE_VERSION = 'v147';
const STATIC_CACHE = `wine-cellar-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `wine-cellar-dynamic-${CACHE_VERSION}`;
const API_CACHE = `wine-cellar-api-${CACHE_VERSION}`;

/**
 * Static assets to pre-cache during install.
 * These are essential for the app shell.
 *
 * NOTE: JS modules should NOT have version query strings because other
 * modules import them without versions (e.g., import { state } from './app.js')
 * Using versions would cause the browser to load the same file twice.
 * Cache invalidation is handled by bumping CACHE_VERSION instead.
 */
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css?v=20260218b',
  '/css/variables.css?v=20260218b',
  '/css/layout.css?v=20260218b',
  '/css/components.css?v=20260218b',
  '/css/themes.css?v=20260218b',
  '/css/accessibility.css?v=20260218b',
  '/js/theme-init.js',
  '/js/app.js',
  '/js/api.js',
  '/js/utils.js',
  '/js/grid.js',
  '/js/modals.js',
  '/js/dragdrop.js',
  '/js/bottles.js',
  '/js/bottles/state.js',
  '/js/bottles/modal.js',
  '/js/bottles/form.js',
  '/js/bottles/wineSearch.js',
  '/js/bottles/textParsing.js',
  '/js/bottles/imageParsing.js',
  '/js/bottles/slotPicker.js',
  '/js/bottles/disambiguationModal.js',
  '/js/bottles/wineConfirmation.js',
  '/js/grapeData.js',
  '/js/grapeAutocomplete.js',
  '/js/grapeIndicator.js',
  '/js/sommelier.js',
  '/js/ratings.js',
  '/js/settings.js',
  '/js/settings-backup.js',
  '/js/virtualList.js',
  '/js/globalSearch.js',
  '/js/accessibility.js',
  '/js/cellarAnalysis.js',
  '/js/cellarAnalysis/state.js',
  '/js/cellarAnalysis/analysis.js',
  '/js/cellarAnalysis/analysisState.js',
  '/js/cellarAnalysis/labels.js',
  '/js/cellarAnalysis/moves.js',
  '/js/cellarAnalysis/fridge.js',
  '/js/cellarAnalysis/zones.js',
  '/js/cellarAnalysis/zoneChat.js',
  '/js/cellarAnalysis/zoneCapacityAlert.js',
  '/js/cellarAnalysis/zoneReconfigurationBanner.js',
  '/js/cellarAnalysis/zoneReconfigurationModal.js',
  '/js/cellarAnalysis/zoneProposalView.js',
  '/js/cellarAnalysis/issueDigest.js',
  '/js/cellarAnalysis/aiAdvice.js',
  '/js/cellarAnalysis/aiAdviceActions.js',
  '/js/cellarAnalysis/moveGuide.js',
  '/js/cellarAnalysis/freshness.js',
  '/js/cellarAnalysis/grapeHealth.js',
  '/js/cellarAnalysis/consolidation.js',
  '/js/onboarding.js',
  '/js/storageBuilder.js',
  '/js/tastingService.js',
  '/js/recommendations.js',
  '/js/errorBoundary.js',
  '/js/eventManager.js',
  '/js/pairing.js',
  '/js/restaurantPairing.js',
  '/js/restaurantPairing/state.js',
  '/js/restaurantPairing/imageCapture.js',
  '/js/restaurantPairing/wineReview.js',
  '/js/restaurantPairing/dishReview.js',
  '/js/restaurantPairing/results.js',
  '/js/restaurantPairing/quickPair.js',
  '/js/restaurantPairing/currencyUtils.js',
  '/js/pwa.js',
  '/js/api/base.js',
  '/js/api/index.js',
  '/js/api/profile.js',
  '/js/api/wines.js',
  '/js/api/ratings.js',
  '/js/api/cellar.js',
  '/js/api/settings.js',
  '/js/api/awards.js',
  '/js/api/acquisition.js',
  '/js/api/palate.js',
  '/js/api/health.js',
  '/js/api/pairing.js',
  '/js/api/restaurantPairing.js',
  '/js/api/errors.js',
  '/vendor/supabase.js',
  '/manifest.json'
];

/**
 * API endpoints that can be cached for offline viewing.
 * These use a network-first strategy with cache fallback.
 */
const CACHEABLE_API_PATTERNS = [
  /\/api\/wines$/,
  /\/api\/wines\/\d+$/,
  /\/api\/slots$/,
  /\/api\/stats$/,
  /\/api\/stats\/layout$/
];

/**
 * Install event - pre-cache static assets.
 */
globalThis.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');

  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Pre-caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        // Skip waiting to activate immediately
        return globalThis.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Pre-cache failed:', error);
      })
  );
});

/**
 * Activate event - clean up old caches.
 */
globalThis.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => {
              // Delete old versioned caches
              return name.startsWith('wine-cellar-') &&
                     !name.endsWith(CACHE_VERSION);
            })
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        // Claim all clients immediately
        return globalThis.clients.claim();
      })
  );
});

/**
 * Fetch event - implement caching strategies.
 */
globalThis.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip cross-origin requests (external APIs, CDNs)
  if (url.origin !== location.origin) {
    return;
  }

  // API requests: Network-first with cache fallback
  if (url.pathname.startsWith('/api/')) {
    // Long-running AI endpoints: pass through directly without SW timeout.
    // These have their own AbortController timeouts on the client side.
    if (url.pathname.includes('/analyse/ai') ||
        url.pathname.includes('/reconfiguration-plan')) {
      return;
    }
    event.respondWith(networkFirstWithCache(request));
    return;
  }

  // Static assets: Cache-first with network fallback
  event.respondWith(cacheFirstWithNetwork(request));
});

/**
 * Cache-first strategy with network fallback.
 * Best for static assets that rarely change.
 * @param {Request} request - The fetch request
 * @returns {Promise<Response>} The response
 */
async function cacheFirstWithNetwork(request) {
  const cachedResponse = await caches.match(request);

  if (cachedResponse) {
    // Return cached version immediately
    // Also fetch fresh version in background for next time
    fetchAndCache(request, DYNAMIC_CACHE).catch(() => {});
    return cachedResponse;
  }

  // Not in cache, fetch from network
  try {
    const networkResponse = await fetch(request);

    // Cache successful responses
    if (networkResponse.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    // Network failed, return offline fallback
    console.warn('[SW] Network failed for navigation:', error.message);
    return caches.match('/index.html');
  }
}

/**
 * Network-first strategy with cache fallback.
 * Best for API data that should be fresh when possible.
 * @param {Request} request - The fetch request
 * @returns {Promise<Response>} The response
 */
async function networkFirstWithCache(request) {
  const url = new URL(request.url);

  // Check if this API endpoint is cacheable
  const isCacheable = CACHEABLE_API_PATTERNS.some(pattern =>
    pattern.test(url.pathname)
  );

  try {
    // Race network against a timeout to prevent PWA freeze on slow connections
    const NETWORK_TIMEOUT_MS = 10000;
    const networkResponse = await Promise.race([
      fetch(request),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Network timeout')), NETWORK_TIMEOUT_MS)
      )
    ]);

    // Cache successful GET responses for cacheable endpoints
    if (networkResponse.ok && isCacheable) {
      const cache = await caches.open(API_CACHE);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    // Network failed or timed out, try cache
    console.warn('[SW] API fetch failed:', error.message);
    const cachedResponse = await caches.match(request);

    if (cachedResponse) {
      console.log('[SW] Serving API from cache:', url.pathname);
      return cachedResponse;
    }

    // Return error response for API failures
    return new Response(
      JSON.stringify({
        error: 'Offline',
        message: 'This feature requires an internet connection'
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

/**
 * Fetch and cache in background (stale-while-revalidate).
 * @param {Request} request - The fetch request
 * @param {string} cacheName - The cache to store in
 */
async function fetchAndCache(request, cacheName) {
  try {
    const response = await fetch(request);

    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response);
    }
  } catch (error) {
    // Background revalidation failure is non-critical
    console.debug('[SW] Background fetch failed:', error.message);
  }
}

/**
 * Handle messages from the main thread.
 */
globalThis.addEventListener('message', (event) => {
  if (!event.source) return; // Ignore messages without a source window
  if (event.data?.type === 'SKIP_WAITING') {
    globalThis.skipWaiting();
  }

  if (event.data?.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((name) => caches.delete(name))
        );
      })
    );
  }
});

/**
 * Background sync for offline actions.
 * Queued actions will be synced when connection is restored.
 */
globalThis.addEventListener('sync', (event) => {
  console.log('[SW] Background sync triggered:', event.tag);

  if (event.tag === 'sync-wines') {
    event.waitUntil(syncPendingWines());
  }
});

/**
 * Sync pending wine changes that were made offline.
 */
async function syncPendingWines() {
  // This would read from IndexedDB and send to server
  // For now, just log that sync was requested
  console.log('[SW] Syncing pending wine changes...');
}

/**
 * Push notification handler (for future use).
 */
globalThis.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();

  const options = {
    body: data.body || 'Check your wine cellar',
    icon: '/images/icon-192.png',
    badge: '/images/badge-72.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/'
    }
  };

  event.waitUntil(
    globalThis.registration.showNotification(data.title || 'Wine Cellar', options)
  );
});

/**
 * Notification click handler.
 */
globalThis.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window' })
      .then((windowClients) => {
        // Check if there's already a window open
        for (const client of windowClients) {
          if (client.url === url && 'focus' in client) {
            return client.focus();
          }
        }
        // Open new window
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});
