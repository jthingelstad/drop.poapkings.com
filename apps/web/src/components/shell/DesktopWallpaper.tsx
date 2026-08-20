import { useLayoutEffect, useRef } from 'preact/hooks'
import { isReducedMotionEnabled } from '../../lib/motion'
import { desktopFallingCardsMode, screensaverActive } from '../../lib/screensaver'
import type { ElixirRainScene } from '../ScreensaverScene'

// The desktop wallpaper is the real Falling Cards scene, not a lookalike. It
// stays mounted behind every desktop route so hiding the shell reveals the same
// running canvas instead of launching and loading a second effect.
export default function DesktopWallpaper() {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<ElixirRainScene | null>(null)
  const mode = desktopFallingCardsMode.value
  const enabled = mode !== 'off'
  const foreground = screensaverActive.value !== null
  const subtle = mode === 'subtle' && !foreground

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return

    let disposed = false
    void (async () => {
      try {
        const { createElixirRain } = await import('../ScreensaverScene')
        if (disposed) return
        const created = await createElixirRain(host, {
          paused: isReducedMotionEnabled(),
          foreground: screensaverActive.value !== null,
          enabled: desktopFallingCardsMode.value !== 'off'
        })
        if (disposed) created.destroy()
        else sceneRef.current = created
      } catch (error) {
        // The fixed dark field is still a safe background if WebGL is missing.
        console.warn('Falling Cards background could not initialize', error)
      }
    })()

    return () => {
      disposed = true
      sceneRef.current?.destroy()
      sceneRef.current = null
    }
  }, [])

  useLayoutEffect(() => {
    sceneRef.current?.setEnabled(enabled)
  }, [enabled])

  useLayoutEffect(() => {
    sceneRef.current?.setForeground(foreground)
  }, [foreground])

  return (
    <div
      ref={hostRef}
      class={`ed-wallpaper${enabled ? '' : ' ed-wallpaper--off'}${subtle ? ' ed-wallpaper--subtle' : ''}`}
      aria-hidden="true"
    />
  )
}
