import { useEffect, useRef } from 'preact/hooks'

// Window-level keydown for a game surface. Bound once for the component's life
// — a ref keeps the handler current without re-binding on every render — and
// gated so a game never claims a keystroke that is not its own: modifier
// chords belong to the browser, auto-repeat would let a held key machine-gun
// answers, and anything typed into a text field belongs to that field.
export function useGameKeys(handler: (event: KeyboardEvent) => void): void {
  const latest = useRef(handler)
  latest.current = handler

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      latest.current(event)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
