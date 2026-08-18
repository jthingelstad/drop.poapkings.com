import { BADGE_BY_SLUG, badgeTier } from '@elixir-drop/contracts'
import { formatRungValue, type BadgeView } from '../lib/badges'
import BadgeMedallion from './BadgeMedallion'

export interface EarnedRung {
  slug: string
  rungIndex: number
  value: number
  at: string
}

// Map the rungs a run cleared to full badge views. Shared by the summary's
// "what changed" ledger and the earn celebration, so they can never disagree
// about a badge's tier, name or chip.
export function earnedRungViews(earned: EarnedRung[]): BadgeView[] {
  return earned.flatMap((rung) => {
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
}

// The earn moment inline on the summary: the rungs a single run cleared.
//
// Uses the -384 file: 172px is the only place a badge is rendered large enough
// to need it.
export default function BadgeEarned({ earned }: { earned: EarnedRung[] }) {
  const views = earnedRungViews(earned)
  if (!views.length) return null

  return (
    <div class="ed-earned" role="status">
      <div class="ed-earned__title">{views.length === 1 ? 'Badge earned' : `${views.length} badges earned`}</div>
      <div class="ed-earned__row">
        {views.map((view) => (
          <div class="ed-earned__item" key={`${view.slug}-${view.rungIndex}`}>
            <BadgeMedallion badge={view} size={172} file={384} />
            <span class="ed-earned__name">{view.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
