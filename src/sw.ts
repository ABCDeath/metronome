/// <reference lib="webworker" />
import { addPlugins, cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope

// Apply isolation headers to navigation responses even when served offline.
// Workbox owns routing for every precached asset, including the worklet and WASM.
addPlugins([{
  async handlerWillRespond({ request, response }) {
    if (request.mode !== 'navigate') return response
    const headers = new Headers(response.headers)
    headers.set('Cross-Origin-Opener-Policy', 'same-origin')
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  },
}])
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.delete('metronome-static-v1'),
  ]))
})
