const CACHE='celina-puzzle-v88-hide-locked';
const ASSETS=['./','./index.html','./style.css','./game.js','./play.html','./manifest.json','./favicon.svg','./icon.svg'];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

const NET_FIRST = /\.(?:html|css|js|json)(?:\?.*)?$/i;
const STATIC_FIRST = /\b(sudokupad\.appx|favicon|icon|images|fonts)\b/i;

// Always returns a Response, never undefined or rejected promise.
// Adblockers can ERR_BLOCKED_BY_CLIENT a fetch — without this, the SW throws.
function safe(promise, fallbackText){
  return promise.then(r => {
    if (r instanceof Response) return r;
    return new Response(fallbackText || '', { status: 504, headers: { 'content-type': 'text/plain' } });
  }).catch(err => new Response('sw: ' + (err && err.message || err), {
    status: 502,
    headers: { 'content-type': 'text/plain' }
  }));
}

function tryCacheThenNetwork(request){
  return safe(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(resp => {
        if (resp && resp.ok && resp.type !== 'opaque') {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(request, clone)).catch(()=>{});
        }
        return resp;
      });
    })
  );
}

function tryNetworkThenCache(request){
  return safe(
    fetch(request).then(resp => {
      if (resp && resp.ok && resp.type !== 'opaque') {
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(request, clone)).catch(()=>{});
      }
      return resp;
    }).catch(() => caches.match(request).then(c => c || null))
  );
}

self.addEventListener('fetch', e => {
  let url;
  try { url = new URL(e.request.url); } catch(_) { return; }
  // Skip non-http schemes (chrome-extension://, data:, etc.) — caching them throws.
  if (!/^https?:$/.test(url.protocol)) return;
  // POST/PUT/etc. — let browser handle.
  if (e.request.method !== 'GET') return;

  // Pass-through: nginx-proxied endpoints (puzzle data + assets from sudokupad.app).
  // Don't cache these in the SW — nginx already caches them.
  if (url.origin === location.origin && (url.pathname.startsWith('/api/puzzle/') || url.pathname.startsWith('/assets/'))) {
    return;
  }

  // Cross-origin: stale-while-revalidate. Catches adblocker rejections.
  if (url.origin !== location.origin) {
    e.respondWith(safe(
      caches.match(e.request).then(cached => {
        const fp = fetch(e.request).then(resp => {
          if (resp && resp.ok && resp.type !== 'opaque') {
            const clone = resp.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone)).catch(()=>{});
          }
          return resp;
        }).catch(() => cached);
        return cached || fp;
      })
    ));
    return;
  }

  // SudokuPad bundle / images / fonts → cache-first
  if (STATIC_FIRST.test(url.pathname)) {
    e.respondWith(tryCacheThenNetwork(e.request));
    return;
  }

  // App source (.html/.css/.js/.json) → network-first
  if (NET_FIRST.test(url.pathname) || url.pathname === '/' || url.pathname.endsWith('/')) {
    e.respondWith(tryNetworkThenCache(e.request));
    return;
  }

  // Default: cache-first
  e.respondWith(tryCacheThenNetwork(e.request));
});
