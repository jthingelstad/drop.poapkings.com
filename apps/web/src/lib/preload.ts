import type { Card } from '../types'

// Preload card art so nothing pops in mid-run. Resolves on load OR error, and
// never hangs (a blocked/slow CDN still settles via the timeout). The callback
// reports how many images actually loaded so timed modes where the art IS the
// question (Identify) can refuse to start the clock against gray boxes.
export function preloadImages(cards: Card[], done: (loadedCount: number) => void, timeoutMs = 2500): void {
  const urls = cards.map((c) => c.icon).filter(Boolean)
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
    img.onload = tick(true)
    img.onerror = tick(false)
    img.src = u
  }
  setTimeout(finish, timeoutMs)
}
