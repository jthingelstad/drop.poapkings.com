import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderBadgeSharePreview, renderProfileSharePreview } from '../../src/lib/share-card'

// Since 2026-11-14 the name on a share card is the Clash Royale game name from
// Elixir, and the game allows almost any text in it. The canvas compositor
// must draw it as text (fillText), never parse it: nothing in the document
// changes, and the exact characters reach the canvas.

const HOSTILE = `<img src=x onerror=alert(1)>"&'</script>`

const drawn: string[] = []

function fakeContext() {
  const gradient = { addColorStop: () => undefined }
  return new Proxy(
    {
      fillText: (value: string) => drawn.push(value),
      measureText: (value: string) => ({ width: value.length * 10 }),
      createRadialGradient: () => gradient,
      createLinearGradient: () => gradient
    } as Record<string, unknown>,
    {
      get(target, key: string) {
        if (key in target) return target[key]
        return () => undefined
      },
      set(target, key: string, value) {
        target[key] = value
        return true
      }
    }
  )
}

beforeEach(() => {
  drawn.length = 0
  const realCreate = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag !== 'canvas') return realCreate(tag)
    return {
      width: 0,
      height: 0,
      getContext: () => fakeContext(),
      toBlob: (done: (blob: Blob) => void) => done(new Blob(['png'], { type: 'image/png' }))
    } as unknown as HTMLCanvasElement
  }) as typeof document.createElement)
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 100
      naturalHeight = 100
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    }
  )
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { load: async () => [], check: () => true }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('share cards draw a hostile game name as text', () => {
  it('profile card', async () => {
    const before = document.documentElement.outerHTML
    const blob = await renderProfileSharePreview({
      playerName: HOSTILE,
      favoriteCardId: 26000000,
      xp: 900,
      arena: 8,
      badgeCount: 0,
      badges: []
    })
    expect(blob).toBeInstanceOf(Blob)
    expect(drawn).toContain(HOSTILE)
    expect(document.documentElement.outerHTML).toBe(before)
  })

  it('badge card', async () => {
    const before = document.documentElement.outerHTML
    const blob = await renderBadgeSharePreview({
      playerName: HOSTILE,
      favoriteCardId: 26000000,
      slug: 'clockbreaker',
      name: 'Clockbreaker',
      tier: 'gold',
      chip: '25s',
      rungIndex: 0,
      rungCount: 4,
      hidden: false
    } as Parameters<typeof renderBadgeSharePreview>[0])
    expect(blob).toBeInstanceOf(Blob)
    expect(drawn).toContain(HOSTILE)
    expect(document.documentElement.outerHTML).toBe(before)
  })
})
