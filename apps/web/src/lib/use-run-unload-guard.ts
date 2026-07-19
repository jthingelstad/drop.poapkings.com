import { useEffect } from 'preact/hooks'

// Refreshing or closing the tab mid-run silently discards the game; ask the
// browser to confirm while a run is actively being played.
export function useRunUnloadGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [active])
}
