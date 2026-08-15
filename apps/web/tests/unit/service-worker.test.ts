import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const ORIGIN = 'https://drop.poapkings.com'

function requestUrl(input: RequestInfo | URL | { url: string }): string {
  if (typeof input === 'string') return new URL(input, ORIGIN).href
  if (input instanceof URL) return input.href
  return input.url
}

class MemoryCache {
  readonly entries = new Map<string, Response>()

  async match(input: RequestInfo | URL | { url: string }): Promise<Response | undefined> {
    return this.entries.get(requestUrl(input))?.clone()
  }

  async put(input: RequestInfo | URL | { url: string }, response: Response): Promise<void> {
    this.entries.set(requestUrl(input), response.clone())
  }

  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((url) => new Request(url))
  }
}

class MemoryCacheStorage {
  readonly stores = new Map<string, MemoryCache>()

  async open(name: string): Promise<MemoryCache> {
    const existing = this.stores.get(name)
    if (existing) return existing
    const cache = new MemoryCache()
    this.stores.set(name, cache)
    return cache
  }

  async keys(): Promise<string[]> {
    return [...this.stores.keys()]
  }

  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name)
  }

  async match(
    input: RequestInfo | URL | { url: string },
    options?: { cacheName?: string }
  ): Promise<Response | undefined> {
    if (options?.cacheName) return this.stores.get(options.cacheName)?.match(input)
    for (const cache of this.stores.values()) {
      const response = await cache.match(input)
      if (response) return response
    }
    return undefined
  }
}

interface WorkerEvent {
  data?: { type?: string; urls?: string[] }
  request?: { method: string; mode: string; url: string }
  waitUntil?: (promise: Promise<unknown>) => void
  respondWith?: (promise: Promise<Response>) => void
}

function workerHarness() {
  const listeners = new Map<string, (event: WorkerEvent) => void>()
  const caches = new MemoryCacheStorage()
  const responses = new Map<string, Response>()
  const failures = new Set<string>()
  const fetchMock = vi.fn(async (input: RequestInfo | URL | { url: string }) => {
    const url = requestUrl(input)
    if (failures.has(url)) throw new TypeError('offline')
    const response = responses.get(url)
    return response?.clone() ?? new Response('not found', { status: 404 })
  })
  const workerSelf = {
    location: { href: `${ORIGIN}/card-art-sw.js?build=build-b&catalog=catalog-1`, origin: ORIGIN },
    clients: { claim: vi.fn(async () => undefined) },
    skipWaiting: vi.fn(async () => undefined),
    addEventListener(type: string, listener: (event: WorkerEvent) => void) {
      listeners.set(type, listener)
    }
  }

  runInNewContext(readFileSync('public/card-art-sw.js', 'utf8'), {
    self: workerSelf,
    caches,
    fetch: fetchMock,
    URL,
    Request,
    Response,
    Set,
    Promise,
    Error,
    TypeError
  })

  async function dispatch(type: string, event: WorkerEvent): Promise<Response | undefined> {
    let pending: Promise<unknown> = Promise.resolve()
    let response: Promise<Response> | undefined
    listeners.get(type)?.({
      ...event,
      waitUntil: (value) => {
        pending = value
      },
      respondWith: (value) => {
        response = value
      }
    })
    await pending
    return response ? response : undefined
  }

  return { caches, dispatch, failures, responses }
}

describe('offline app-shell worker', () => {
  it('keeps the prior shell through activation and a failed replacement, then serves it offline', async () => {
    const harness = workerHarness()
    const previous = await harness.caches.open('elixir-drop-shell-build-a')
    await previous.put('/index.html', new Response('complete build A'))
    await previous.put('/assets/a.js', new Response('A script'))

    await harness.dispatch('activate', {})
    expect(await harness.caches.keys()).toContain('elixir-drop-shell-build-a')

    harness.responses.set(`${ORIGIN}/`, new Response('build B'))
    harness.failures.add(`${ORIGIN}/assets/practice-b.js`)
    await harness.dispatch('message', {
      data: { type: 'cache-shell', urls: ['/', '/assets/practice-b.js'] }
    })

    expect(await previous.match('/index.html')).toBeDefined()
    const current = await harness.caches.open('elixir-drop-shell-build-b')
    expect(await current.match('/index.html')).toBeUndefined()

    harness.failures.add(`${ORIGIN}/`)
    const fallback = await harness.dispatch('fetch', {
      request: { method: 'GET', mode: 'navigate', url: `${ORIGIN}/` }
    })
    await expect(fallback?.text()).resolves.toBe('complete build A')
  })

  it('commits the document last and retires the prior shell after every replacement fetch succeeds', async () => {
    const harness = workerHarness()
    const previous = await harness.caches.open('elixir-drop-shell-build-a')
    await previous.put('/index.html', new Response('complete build A'))
    harness.responses.set(`${ORIGIN}/`, new Response('complete build B'))
    harness.responses.set(`${ORIGIN}/assets/practice-b.js`, new Response('B Practice'))

    await harness.dispatch('message', {
      data: { type: 'cache-shell', urls: ['/', '/assets/practice-b.js'] }
    })

    const current = await harness.caches.open('elixir-drop-shell-build-b')
    await expect((await current.match('/index.html'))?.text()).resolves.toBe('complete build B')
    await expect((await current.match('/assets/practice-b.js'))?.text()).resolves.toBe('B Practice')
    expect(await harness.caches.keys()).not.toContain('elixir-drop-shell-build-a')
  })
})
