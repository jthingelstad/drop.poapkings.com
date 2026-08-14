import { rankFor, zoneFor } from '../data/starRanks'

// One place that turns XP into "how far along this arena am I, and how much is
// left". The You page banner draws its own arena line and needs the same
// numbers as the full card, so neither surface recomputes the thresholds.
export function arenaProgress(xp: number) {
  const { current, next } = rankFor(xp)
  if (!next) return { current, next, fillPct: 100, toGoLabel: 'Top arena reached.' }
  const span = next.threshold - current.threshold
  const into = Math.max(0, xp - current.threshold)
  const togo = Math.max(0, next.threshold - xp)
  return {
    current,
    next,
    fillPct: Math.min(100, Math.round((into / span) * 100)),
    toGoLabel: `${togo.toLocaleString()} XP to ${next.name}`
  }
}

// The bar on its own, for callers that already draw the arena's name and XP
// beside it. The full card below is still the canonical presentation.
export function ArenaProgressBar({ xp }: { xp: number }) {
  return (
    <div class="rank-progress">
      <div class="rank-progress__fill" style={{ width: arenaProgress(xp).fillPct + '%' }} />
    </div>
  )
}

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

  const { fillPct, toGoLabel: progressLabel } = arenaProgress(xp)

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
