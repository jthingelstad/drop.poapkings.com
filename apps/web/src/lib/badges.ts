import { BADGE_LIST, badgeTier, type BadgeDefinition, type BadgeTier } from '@elixir-drop/contracts'
import type { z } from 'zod'
import type { badgeStateSchema } from './api-contracts'

export type BadgeState = z.infer<typeof badgeStateSchema>

// One badge as the UI needs it: the definition, where the player stands, and
// everything derived from those two. Derived here rather than in the component
// so the grid, the detail sheet, and the earn moment can never disagree about
// what tier a badge is or what its chip says.
export interface BadgeView {
  definition: BadgeDefinition
  slug: string
  name: string
  value: number
  rungIndex: number
  tier: BadgeTier
  earned: boolean
  // Hidden AND unearned: renders as a black silhouette and keeps its earning
  // condition secret. The name is always visible; earning reveals everything.
  concealed: boolean
  // The chip label: the rung reached in the badge's own units — "18s", "150",
  // "2.5K" — never a roman numeral. Empty until a rung is cleared.
  chip: string
  nextRung: number | undefined
  // 0..1 toward the next milestone, for the progress bar. Count/best badges
  // use the visible current/target ratio; descending time badges use the span
  // between the last cleared milestone and the next one.
  progress: number
  runsAtRung: number[] | undefined
}

// 2,500 -> "2.5K". Rungs run to five figures, and a medallion chip has room for
// about four characters.
export function formatRungValue(value: number, unit: BadgeDefinition['unit']): string {
  if (unit === 'seconds') {
    // Times are compared to the second; a stored best is fractional.
    return `${value % 1 === 0 ? value : value.toFixed(1)}s`
  }
  if (value >= 1_000) {
    const thousands = value / 1_000
    return `${thousands % 1 === 0 ? thousands : thousands.toFixed(1)}K`
  }
  return String(Math.round(value))
}

function progressToward(definition: BadgeDefinition, value: number, rungIndex: number): number {
  const next = definition.rungs[rungIndex + 1]
  if (next === undefined) return 1
  if (definition.kind !== 'time') return Math.max(0, Math.min(1, value / next))
  const from = definition.rungs[rungIndex] ?? value
  const span = from - next
  if (span <= 0) return 0
  const travelled = from - value
  return Math.max(0, Math.min(1, travelled / span))
}

export function badgeViews(states: BadgeState[]): BadgeView[] {
  const bySlug = new Map(states.map((state) => [state.slug, state]))
  return BADGE_LIST.map((definition) => {
    const state = bySlug.get(definition.slug)
    const rungIndex = state?.rungIndex ?? -1
    const value = state?.value ?? 0
    const earned = rungIndex >= 0
    const reached = definition.rungs[rungIndex]
    return {
      definition,
      slug: definition.slug,
      name: definition.name,
      value,
      rungIndex,
      tier: badgeTier(rungIndex, definition.rungs.length),
      earned,
      concealed: Boolean(definition.hidden) && !earned,
      chip: earned && reached !== undefined ? formatRungValue(reached, definition.unit) : '',
      nextRung: definition.rungs[rungIndex + 1],
      progress: progressToward(definition, value, rungIndex),
      runsAtRung: state?.runsAtRung
    }
  })
}

// Grid order: everything the player has earned, strongest tier first, then the
// rest. A player opening this screen should see what they have, not scroll past
// twenty locked circles to find it.
const TIER_RANK: Record<BadgeTier, number> = {
  prismatic: 0,
  gold: 1,
  silver: 2,
  copper: 3,
  unlit: 4
}

export function sortForGrid(views: BadgeView[]): BadgeView[] {
  return [...views].sort((left, right) => {
    const tier = TIER_RANK[left.tier] - TIER_RANK[right.tier]
    if (tier) return tier
    // Concealed badges sink below plain locked ones: a silhouette is a tease,
    // not a to-do item.
    if (left.concealed !== right.concealed) return left.concealed ? 1 : -1
    return left.name.localeCompare(right.name)
  })
}

export function earnedCount(views: BadgeView[]): number {
  return views.filter((view) => view.earned).length
}
