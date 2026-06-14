import { useEffect, useRef } from 'preact/hooks'
import { rankFor, zoneFor } from '../data/starRanks'

interface Props {
  hits: number
  onClose: () => void
}

function fmt(n: number) {
  return n.toLocaleString('en-US')
}

export default function TrophyModal({ hits, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const { current, next } = rankFor(hits)
  const zone = zoneFor(hits, current, next)

  const artClass = [
    'rank-card__art',
    zone === 'just-passed' ? 'is-just-passed' : '',
    zone === 'close' ? 'is-close' : ''
  ]
    .filter(Boolean)
    .join(' ')

  let fillPct: number
  let progressLabel = 'Top rank reached.'
  if (next) {
    const span = next.threshold - current.threshold
    const into = Math.max(0, hits - current.threshold)
    fillPct = Math.min(100, Math.round((into / span) * 100))
    const togo = Math.max(0, next.threshold - hits)
    progressLabel = `${fmt(togo)} to ${next.name}`
  } else {
    fillPct = 100
  }

  useEffect(() => {
    document.body.classList.add('modal-open')
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => {
      document.body.classList.remove('modal-open')
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div class="trophy-modal" role="dialog" aria-modal="true" aria-label="Trophy Road">
      <button class="trophy-modal__scrim" onClick={onClose} aria-label="Close" tabIndex={-1} />
      <div class="trophy-modal__panel" ref={panelRef} tabIndex={-1}>
        <button class="trophy-modal__close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div class="trophy-modal__title">Trophy Road</div>
        <p class="trophy-modal__hint">Total visits to this site — ranked on Clash Royale arenas.</p>

        <div class="rank-card">
          <div class={artClass}>
            <img class="rank-card__img" src={current.image} alt={current.name + ' arena'} loading="lazy" />
          </div>
          <div class="rank-card__meta">
            <div class="rank-card__eyebrow">Current rank</div>
            <div class="rank-card__name">{current.name}</div>
            <div class="rank-card__count">{fmt(hits)} visits</div>
            <div class="rank-progress">
              <div class="rank-progress__fill" style={{ width: fillPct + '%' }} />
            </div>
            <div class="rank-progress__label">{progressLabel}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
