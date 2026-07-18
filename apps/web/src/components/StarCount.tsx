import { useEffect, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { createPortal } from 'preact/compat'
import { rankFor } from '../data/starRanks'
import TrophyModal from './TrophyModal'
import { getStats } from '../lib/api'

function spawnSparks(badge: HTMLElement) {
  const rect = badge.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const N = 8
  for (let i = 0; i < N; i++) {
    const s = document.createElement('span')
    s.className = 'star-spark'
    s.textContent = '★'
    const angle = (Math.PI * 2 * i) / N + Math.random() * 0.4
    const dist = 42 + Math.random() * 24
    const dx = Math.cos(angle) * dist
    const dy = Math.sin(angle) * dist
    s.style.left = cx + 'px'
    s.style.top = cy + 'px'
    s.style.setProperty('--dx', dx + 'px')
    s.style.setProperty('--dy', dy + 'px')
    s.style.setProperty('--rot', Math.random() * 540 - 270 + 'deg')
    document.body.appendChild(s)
    setTimeout(() => {
      if (s.parentNode) s.parentNode.removeChild(s)
    }, 800)
  }
}

export default function StarCount() {
  const ref = useRef<HTMLButtonElement>(null)
  const modalOpen = useSignal(false)
  const hits = useSignal(0)

  useEffect(() => {
    const badge = ref.current
    if (!badge) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let cancelled = false
    void getStats()
      .then(({ totalGames }) => {
        if (cancelled) return
        hits.value = totalGames
        if (reduce) return
        badge.classList.add('is-anticipating')
        setTimeout(() => {
          badge.classList.remove('is-anticipating')
          badge.classList.add('is-popping')
          spawnSparks(badge)
          const plus = document.createElement('span')
          plus.className = 'starcount__plus'
          plus.textContent = '+1'
          badge.appendChild(plus)
          setTimeout(() => {
            badge.classList.remove('is-popping')
            if (plus.parentNode) plus.parentNode.removeChild(plus)
          }, 1000)
        }, 180)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [hits])

  const rank = rankFor(hits.value).current

  return (
    <>
      <button
        ref={ref}
        class="starcount"
        onClick={() => (modalOpen.value = true)}
        title={`Trophy Road — ${rank.name}`}
        aria-label={`Trophy Road, ${rank.name}`}
      >
        <img src="/assets/emoji/elixir_trophy.png" alt="" class="starcount__icon" aria-hidden="true" />
        <span class="starcount__n">{hits.value.toLocaleString()}</span>
      </button>
      {modalOpen.value &&
        createPortal(<TrophyModal hits={hits.value} onClose={() => (modalOpen.value = false)} />, document.body)}
    </>
  )
}
