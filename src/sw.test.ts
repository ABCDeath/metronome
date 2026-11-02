import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

class WorkerEvent {
  promises: Promise<unknown>[] = []
  constructor(public type: string) {}
  waitUntil(promise: Promise<unknown>) { this.promises.push(promise) }
  async done() {
    // Workbox may add lifetime promises as its earlier callbacks finish.
    for (let i = 0; i < this.promises.length; i++) await this.promises[i]
  }
}

class WorkerFetchEvent extends WorkerEvent {
  response: Promise<Response> | null = null
  responseCount = 0
  constructor(public request: Request) { super('fetch') }
  respondWith(response: Promise<Response>) {
    if (++this.responseCount > 1) throw new Error('respondWith called twice')
    this.response = response
  }
}

class MemoryCache {
  entries = new Map<string, Response>()
  async match(request: Request) { return this.entries.get(request.url)?.clone() }
  async put(request: Request, response: Response) { this.entries.set(request.url, response.clone()) }
  async keys() { return [...this.entries.keys()].map(url => new Request(url)) }
  async delete(request: Request) { return this.entries.delete(request.url) }
}

const origin = 'https://metronome.test'
const listeners = new Map<string, ((event: WorkerEvent) => void)[]>()
const cacheStore = new Map<string, MemoryCache>()
const assets = ['index.html', 'worklet/processor.js', 'wasm/metronome_engine_bg.wasm']

async function dispatch(event: WorkerEvent) {
  for (const listener of listeners.get(event.type) ?? []) listener(event)
  await event.done()
}

beforeAll(async () => {
  vi.stubGlobal('ExtendableEvent', WorkerEvent)
  vi.stubGlobal('FetchEvent', WorkerFetchEvent)
  vi.stubGlobal('location', new URL(`${origin}/sw.js`))
  vi.stubGlobal('registration', { scope: `${origin}/` })
  vi.stubGlobal('__WB_DISABLE_DEV_LOGS', true)
  vi.stubGlobal('self', {
    __WB_DISABLE_DEV_LOGS: true,
    __WB_MANIFEST: assets.map(url => ({ url, revision: 'test-revision' })),
    location: new URL(`${origin}/sw.js`),
    registration: { scope: `${origin}/` },
    clients: { claim: vi.fn(async () => {}) },
    skipWaiting: vi.fn(async () => {}),
    addEventListener(type: string, listener: (event: WorkerEvent) => void) {
      listeners.set(type, [...listeners.get(type) ?? [], listener])
    },
  })
  vi.stubGlobal('caches', {
    async match(request: Request, options: { cacheName?: string } = {}) {
      for (const [name, cache] of cacheStore) {
        if (options.cacheName && name !== options.cacheName) continue
        const response = await cache.match(request)
        if (response) return response
      }
      return undefined
    },
    async open(name: string) {
      if (!cacheStore.has(name)) cacheStore.set(name, new MemoryCache())
      return cacheStore.get(name)
    },
    async keys() { return [...cacheStore.keys()] },
    async delete(name: string) { return cacheStore.delete(name) },
  })
  vi.stubGlobal('fetch', vi.fn(async (request: Request) => new Response(request.url, {
    headers: { 'Content-Type': request.url.includes('.wasm') ? 'application/wasm' : 'text/plain' },
  })))
  Object.assign(self, { caches })
  await import('./sw.js')
  await dispatch(new WorkerEvent('install'))
  cacheStore.set('metronome-static-v1', new MemoryCache())
  await dispatch(new WorkerEvent('activate'))
  vi.mocked(fetch).mockRejectedValue(new Error('offline'))
})

afterAll(() => { vi.unstubAllGlobals() })

describe('service worker precache routing', () => {
  it.each(['/', '/index.html', '/worklet/processor.js', '/wasm/metronome_engine_bg.wasm'])(
    'serves %s offline with only one respondWith owner', async (path) => {
      const request = new Request(`${origin}${path}`)
      if (path === '/' || path === '/index.html') {
        Object.defineProperty(request, 'mode', { value: 'navigate' })
      }
      const event = new WorkerFetchEvent(request)
      await dispatch(event)
      expect(event.responseCount).toBe(1)
      const response = await event.response!
      expect(response.status).toBe(200)
      expect(await response.text()).toContain(path === '/' ? '/index.html' : path)
      if (request.mode === 'navigate') {
        expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin')
        expect(response.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp')
      }
    },
  )

  it('removes the obsolete fixed-name cache on activation', () => {
    expect(cacheStore.has('metronome-static-v1')).toBe(false)
  })
})
