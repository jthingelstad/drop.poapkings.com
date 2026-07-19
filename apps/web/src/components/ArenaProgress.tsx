import { rankFor, zoneFor } from '../data/starRanks'

// The player's arena on Drop's Trophy Road — now a per-player journey driven by
// lifetime Player XP. Rendered inline on the profile (no modal).
export default function ArenaProgress({ xp }: { xp: number }) {
  const { current, next } = rankFor(xp)
  const zone = zoneFor(xp, current, next)

  const artClass = [
    'rank-card__art',
    zone === 'just-passed' ? 'is-just-passed' : '',
    zone === 'close' ? 'is-close' : ''
  ]
    .filter(Boolean)
    .join(' ')

  let fillPct = 100
  let progressLabel = 'Top arena reached.'
  if (next) {
    const span = next.threshold - current.threshold
    const into = Math.max(0, xp - current.threshold)
    fillPct = Math.min(100, Math.round((into / span) * 100))
    const togo = Math.max(0, next.threshold - xp)
    progressLabel = `${togo.toLocaleString()} XP to ${next.name}`
  }

  return (
    <div class="rank-card">
      <div class={artClass}>
        <img class="rank-card__img" src={current.image} alt={current.name + ' arena'} loading="lazy" />
      </div>
      <div class="rank-card__meta">
        <div class="rank-card__eyebrow">Arena {current.n} of 28</div>
        <div class="rank-card__name">{current.name}</div>
        <div class="rank-card__count">{xp.toLocaleString()} XP</div>
        <div class="rank-progress">
          <div class="rank-progress__fill" style={{ width: fillPct + '%' }} />
        </div>
        <div class="rank-progress__label">{progressLabel}</div>
      </div>
    </div>
  )
}
