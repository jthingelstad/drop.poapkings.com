import { useLayoutEffect, useRef } from 'preact/hooks'
import { stopScreensaver } from '../lib/screensaver'
import { layout } from '../lib/use-layout'

// The "Elixir Rain" focus/exit shell. Mobile lazily creates the Pixi scene here.
// Desktop already runs that scene as its wallpaper, so activation only hides
// the panels and adds this transparent input-capture layer.
export default function Screensaver() {
  const hostRef = useRef<HTMLDivElement>(null)
  const usesDesktopBackground = layout.value === 'desktop'

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

    // Desktop already owns the advanced renderer as its persistent background.
    // This layer only captures the dismissing input while the shell is hidden,
    // so the canvas and its animation never restart.
    if (usesDesktopBackground) {
      return () => {
        window.removeEventListener('pointerdown', exit, { capture: true })
        window.removeEventListener('keydown', exit, { capture: true })
        window.removeEventListener('touchstart', exit, { capture: true })
        window.removeEventListener('wheel', exit, { capture: true })
        document.body.classList.remove('modal-open')
        previouslyFocused?.focus?.()
      }
    }

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
  }, [usesDesktopBackground])

  return (
    <div
      ref={hostRef}
      class={`screensaver${usesDesktopBackground ? ' screensaver--desktop-background' : ''}`}
      data-testid="screensaver"
      role="dialog"
      aria-modal="true"
      aria-label="Screensaver. Press any key or tap anywhere to exit."
      tabIndex={-1}
    />
  )
}
