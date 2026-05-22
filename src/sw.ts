/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope

// Injected by vite-plugin-pwa at build time — all hashed Vite assets.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Also cache the fixed-path assets (not content-hashed by Vite).
const STATIC_ASSETS = [
  '/worklet/processor.js',
  '/wasm/metronome_engine_bg.wasm',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('metronome-static-v1').then((cache) => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Navigation requests: serve from cache and inject COOP/COEP headers so
// SharedArrayBuffer remains available offline (headers are normally set by
// Cloudflare Pages CDN, but cached responses don't carry them).
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match(req).then((cached) => {
        const source = cached ?? fetch(req)
        return Promise.resolve(source).then((res) => {
          const headers = new Headers(res.headers)
          headers.set('Cross-Origin-Opener-Policy', 'same-origin')
          headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
          return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
        })
      })
    )
    return
  }

  // Non-navigation: cache-first for static assets, network-first otherwise.
  if (STATIC_ASSETS.includes(new URL(req.url).pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => cached ?? fetch(req))
    )
  }
})
