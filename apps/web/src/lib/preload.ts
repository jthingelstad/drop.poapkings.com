import type { Card } from '../types'

// Preload card art so nothing pops in mid-run. Resolves on load OR error, and
// never hangs (a blocked/slow CDN still settles via the timeout).
export function preloadImages(cards: Card[], done: () => void, timeoutMs = 2500): void {
  const urls = cards.map((c) => c.icon).filter(Boolean)
  if (urls.length === 0) {
    done()
    return
  }
  let left = urls.length
  let settled = false
  const finish = () => {
    if (settled) return
    settled = true
    done()
  }
  const tick = () => {
    left -= 1
    if (left <= 0) finish()
  }
  for (const u of urls) {
    const img = new Image()
    img.onload = tick
    img.onerror = tick
    img.src = u
  }
  setTimeout(finish, timeoutMs)
}
