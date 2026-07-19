import { useEffect, useRef } from 'preact/hooks'
import { rankFor, zoneFor } from '../data/starRanks'
import Icon from './Icon'

interface Props {
  trophyRoadGames: number
  onClose: () => void
}

function fmt(n: number) {
  return n.toLocaleString('en-US')
}

function games(n: number) {
  return `${fmt(n)} ${n === 1 ? 'game' : 'games'}`
}

export default function TrophyModal({ trophyRoadGames, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const { current, next } = rankFor(trophyRoadGames)
  const zone = zoneFor(trophyRoadGames, current, next)

  const artClass = [
    'rank-card__art',
    zone === 'just-passed' ? 'is-just-passed' : '',
    zone === 'close' ? 'is-close' : ''
  ]
    .filter(Boolean)
    .join(' ')

  let fillPct: number
  let progressLabel = 'Top rank reached.'
  let rankMoment = `${current.name} is the top of Trophy Road.`
  if (next) {
    const span = next.threshold - current.threshold
    const into = Math.max(0, trophyRoadGames - current.threshold)
    fillPct = Math.min(100, Math.round((into / span) * 100))
    const togo = Math.max(0, next.threshold - trophyRoadGames)
    progressLabel = `${games(togo)} to ${next.name}`
    rankMoment =
      zone === 'close'
        ? `${games(togo)} away from ${next.name}.`
        : zone === 'just-passed'
          ? `${current.name} unlocked. Next arena: ${next.name}.`
          : `${games(togo)} until ${next.name}.`
  } else {
    fillPct = 100
  }

  useEffect(() => {
    const dialog = dialogRef.current
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.classList.add('modal-open')
    const onCancel = (event: Event) => {
      event.preventDefault()
      onClose()
    }
    dialog?.addEventListener('cancel', onCancel)
    if (dialog && !dialog.open) dialog.showModal()
    closeRef.current?.focus()
    return () => {
      document.body.classList.remove('modal-open')
      dialog?.removeEventListener('cancel', onCancel)
      if (dialog?.open) dialog.close()
      window.setTimeout(() => previouslyFocused?.focus(), 0)
    }
  }, [onClose])

  return (
    <dialog
      class="trophy-modal"
      ref={dialogRef}
      aria-labelledby="trophy-modal-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div class="trophy-modal__panel">
        <button class="trophy-modal__close" ref={closeRef} onClick={onClose} aria-label="Close Trophy Road">
          <Icon name="x" />
        </button>
        <div class="trophy-modal__title" id="trophy-modal-title">
          Trophy Road
        </div>
        <p class="trophy-modal__hint">Every completed, recorded Drop game adds one to the whole site’s road.</p>
        <div class={`rank-moment rank-moment--${zone}`}>{rankMoment}</div>

        <div class="rank-card">
          <div class={artClass}>
            <img class="rank-card__img" src={current.image} alt={current.name + ' arena'} loading="lazy" />
          </div>
          <div class="rank-card__meta">
            <div class="rank-card__eyebrow">Current rank</div>
            <div class="rank-card__name">{current.name}</div>
            <div class="rank-card__count">{fmt(trophyRoadGames)} Drop games</div>
            <div class="rank-progress">
              <div class="rank-progress__fill" style={{ width: fillPct + '%' }} />
            </div>
            <div class="rank-progress__label">{progressLabel}</div>
          </div>
        </div>
      </div>
    </dialog>
  )
}
