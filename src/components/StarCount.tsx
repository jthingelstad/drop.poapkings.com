import { useEffect, useRef } from 'preact/hooks'

// Drop Stars — a self-contained hit counter wearing the POAP KINGS .starcount
// look. The number is filled in by Tinylytics (.tinylytics_hits, ?hits in the
// embed); when it lands we pop the drop + flash a "+1" spark. Honors reduced motion.
export default function StarCount() {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const num = root.querySelector('.tinylytics_hits')
    if (!num) return

    const pop = () => {
      if (!num.textContent?.trim()) return
      root.classList.remove('starcount--pop')
      // reflow so the animation can replay
      void root.offsetWidth
      root.classList.add('starcount--pop')
    }

    // Tinylytics may fill the count after we mount; watch for it, then pop once.
    const obs = new MutationObserver(() => pop())
    obs.observe(num, { childList: true, characterData: true, subtree: true })
    const t = setTimeout(pop, 600) // in case it was already populated
    return () => {
      obs.disconnect()
      clearTimeout(t)
    }
  }, [])

  return (
    <span ref={ref} class="starcount" title="Drop Stars — total plays counted by Tinylytics">
      <span class="pl-elixir__drop pl-elixir__drop--gold starcount__drop" aria-hidden="true" />
      <span class="tinylytics_hits starcount__num" aria-label="total plays" />
      <span class="starcount__spark" aria-hidden="true">
        +1
      </span>
    </span>
  )
}
