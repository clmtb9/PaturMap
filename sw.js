// ══════════════════════════════════════════════════════
//  PâturMap — Service Worker
//  Stratégie : Cache-first pour les assets statiques,
//  Network-first pour les tuiles de carte (avec fallback cache)
// ══════════════════════════════════════════════════════

const VERSION = 'v3';
const CACHE_STATIC = `paturmap-static-${VERSION}`;
const CACHE_TILES  = `paturmap-tiles-${VERSION}`;

// Assets to cache immediately on install
const STATIC_ASSETS = [
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=DM+Sans:wght@300;400;500;600&display=swap'
];

// ── INSTALL — cache static assets ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE — clean old caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_STATIC && k !== CACHE_TILES)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Tuiles OpenStreetMap — Network-first, fallback to cache
  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(tileStrategy(event.request));
    return;
  }

  // Google Fonts — Cache-first
  if (url.hostname.includes('fonts.g') || url.hostname.includes('fonts.gstatic')) {
    event.respondWith(cacheFirst(event.request, CACHE_STATIC));
    return;
  }

  // CDN (Leaflet, etc.) — Cache-first
  if (url.hostname === 'cdnjs.cloudflare.com') {
    event.respondWith(cacheFirst(event.request, CACHE_STATIC));
    return;
  }

  // Nominatim (geocoding) — Network only, pas de cache
  if (url.hostname.includes('nominatim')) {
    event.respondWith(fetch(event.request).catch(() =>
      new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } })
    ));
    return;
  }

  // App shell (index.html, manifest, icons) — Cache-first
  event.respondWith(cacheFirst(event.request, CACHE_STATIC));
});

// ── STRATEGIES ──

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Hors ligne — ressource non disponible.', { status: 503 });
  }
}

async function tileStrategy(request) {
  // Try network first (tuiles fraîches)
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_TILES);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Fallback : tuile depuis le cache
    const cached = await caches.match(request);
    if (cached) return cached;
    // Tuile grise 256×256 si vraiment indisponible
    return greyTile();
  }
}

function greyTile() {
  // SVG 256×256 gris neutre — remplace les tuiles manquantes
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
    <rect width="256" height="256" fill="#e8e0d5"/>
    <text x="128" y="128" text-anchor="middle" dominant-baseline="middle"
      font-family="sans-serif" font-size="11" fill="#b0a898">hors ligne</text>
  </svg>`;
  return new Response(svg, {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' }
  });
}
