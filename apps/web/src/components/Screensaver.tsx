import { useLayoutEffect, useRef } from 'preact/hooks'
import { stopScreensaver } from '../lib/screensaver'

// The "Elixir Rain" overlay shell: opaque backdrop, exit on any input, focus
// management, scroll lock. The heavy Pixi scene stays behind a dynamic import
// so nobody pays for the egg until they find it — and if WebGL cannot start,
// the dark overlay still appears and still exits, so the egg never traps.
export default function Screensaver() {
  const hostRef = useRef<HTMLDivElement>(null)

  // Layout effect, not a plain effect: the exit listeners must be attached
  // synchronously with the overlay's first paint. A plain effect runs *after*
  // paint, leaving a one-frame window where the overlay is visible but a key
  // press (Escape) would fall through to the page and never dismiss it.
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    document.body.classList.add('modal-open')
    host.focus()

    const exit = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      stopScreensaver()
    }
    // Capture phase: the dismissing tap or key must never reach the page.
    window.addEventListener('pointerdown', exit, { capture: true })
    window.addEventListener('keydown', exit, { capture: true })
    window.addEventListener('touchstart', exit, { capture: true })
    window.addEventListener('wheel', exit, { capture: true })

    let disposed = false
    let scene: { destroy(): void } | null = null
    void (async () => {
      try {
        const { createElixirRain } = await import('./ScreensaverScene')
        if (disposed) return
        const created = await createElixirRain(host)
        if (disposed) created.destroy()
        else scene = created
      } catch (error) {
        // Progressive enhancement, GameFxLayer precedent: a dark, dismissible
        // overlay is an acceptable floor.
        console.warn('Screensaver scene could not initialize', error)
      }
    })()

    return () => {
      disposed = true
      window.removeEventListener('pointerdown', exit, { capture: true })
      window.removeEventListener('keydown', exit, { capture: true })
      window.removeEventListener('touchstart', exit, { capture: true })
      window.removeEventListener('wheel', exit, { capture: true })
      scene?.destroy()
      document.body.classList.remove('modal-open')
      previouslyFocused?.focus?.()
    }
  }, [])

  return (
    <div
      ref={hostRef}
      class="screensaver"
      data-testid="screensaver"
      role="dialog"
      aria-modal="true"
      aria-label="Screensaver. Press any key or tap anywhere to exit."
      tabIndex={-1}
    />
  )
}
