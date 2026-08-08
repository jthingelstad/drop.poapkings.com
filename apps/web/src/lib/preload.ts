import type { Card } from '../types'

// Preload card art so nothing pops in mid-run. A service-worker hit only proves
// the response bytes are local; the browser can still need another frame (or
// longer on a busy phone) to decode those bytes. Count an image as ready only
// after decode() settles successfully. Errors and the timeout still settle the
// batch so a bad asset can fall back instead of hanging a run forever.
export function preloadImages(cards: Card[], done: (loadedCount: number) => void, timeoutMs = 2500): void {
  preloadUrls(cards.map((c) => c.icon).filter(Boolean), done, timeoutMs)
}

// The same settle-or-timeout behaviour for plain URLs — countdown frames, mode
// emblems, share furniture — rather than bending the card-shaped signature
// above into carrying fake Card objects.
export function preloadUrls(urls: string[], done: (loadedCount: number) => void, timeoutMs = 2500): void {
  if (urls.length === 0) {
    done(0)
    return
  }
  let left = urls.length
  let loaded = 0
  let settled = false
  const finish = () => {
    if (settled) return
    settled = true
    done(loaded)
  }
  const tick = (didLoad: boolean) => () => {
    if (didLoad) loaded += 1
    left -= 1
    if (left <= 0) finish()
  }
  for (const u of urls) {
    const img = new Image()
    img.onload = () => {
      if (typeof img.decode !== 'function') {
        tick(true)()
        return
      }
      void img.decode().then(tick(true), tick(false))
    }
    img.onerror = tick(false)
    img.src = u
  }
  setTimeout(finish, timeoutMs)
}

// Build a monotonic look-ahead cursor for long, ordered decks. The caller can
// gate startup on a small first slice, then ask for only the newly exposed tail
// as play advances. Marking the tail requested before returning keeps repeated
// renders or input events from issuing duplicate image work.
export function createProgressivePreloadPlan(cards: Card[], initiallyRequested: number, lookahead: number) {
  let requestedThrough = Math.min(cards.length, Math.max(0, Math.floor(initiallyRequested)))
  const ahead = Math.max(0, Math.floor(lookahead))

  return {
    next(activeIndex: number): Card[] {
      const active = Math.max(0, Math.floor(activeIndex))
      const nextThrough = Math.min(cards.length, active + 1 + ahead)
      if (nextThrough <= requestedThrough) return []

      const batch = cards.slice(requestedThrough, nextThrough)
      requestedThrough = nextThrough
      return batch
    }
  }
}
