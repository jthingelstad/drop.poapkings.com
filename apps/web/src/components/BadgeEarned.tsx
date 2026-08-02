import { BADGE_BY_SLUG, badgeTier } from '@elixir-drop/contracts'
import { formatRungValue, type BadgeView } from '../lib/badges'
import BadgeMedallion from './BadgeMedallion'

export interface EarnedRung {
  slug: string
  rungIndex: number
  value: number
  at: string
}

// The earn moment: the rungs a single run cleared, shown on its summary.
//
// The burst behind the medallion is `charge-go` — the same file the countdown
// ends on. That reuse is deliberate and it is the only place the run-start art
// appears outside a run start: the two moments should feel related, one opening
// the run and one paying it off.
//
// Uses the -384 file: 172px is the only place a badge is rendered large enough
// to need it.
export default function BadgeEarned({ earned }: { earned: EarnedRung[] }) {
  const views = earned.flatMap((rung) => {
    const definition = BADGE_BY_SLUG.get(rung.slug)
    if (!definition) return []
    const reached = definition.rungs[rung.rungIndex]
    const view: BadgeView = {
      definition,
      slug: definition.slug,
      name: definition.name,
      value: rung.value,
      rungIndex: rung.rungIndex,
      tier: badgeTier(rung.rungIndex, definition.rungs.length),
      earned: true,
      // A hidden badge is fully revealed the moment it is earned — that reveal
      // is the whole payoff.
      concealed: false,
      chip: reached === undefined ? '' : formatRungValue(reached, definition.unit),
      nextRung: definition.rungs[rung.rungIndex + 1],
      progress: 1,
      runsAtRung: undefined
    }
    return [view]
  })
  if (!views.length) return null

  return (
    <div class="ed-earned" role="status">
      <div class="ed-earned__title">{views.length === 1 ? 'Badge earned' : `${views.length} badges earned`}</div>
      <div class="ed-earned__row">
        {views.map((view) => (
          <div class="ed-earned__item" key={`${view.slug}-${view.rungIndex}`}>
            <span class="ed-earned__burst" aria-hidden="true">
              <img src="/assets/start/charge-go-512.png" alt="" width={344} height={344} />
            </span>
            <BadgeMedallion badge={view} size={172} file={384} />
            <span class="ed-earned__name">{view.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
