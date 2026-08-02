import type { BadgeTier } from '@elixir-drop/contracts'
import { renderBadgeShareCard } from './share-card'
import { shareImage, type RunShareOutcome, type RunSharePayload } from './share-run'

export interface BadgeShareInput {
  slug: string
  name: string
  chip: string
  tier: BadgeTier
  requirement?: string
  playerId: string
  playerName: string
}

export function badgeSharePayload(input: BadgeShareInput, href = window.location.href): RunSharePayload {
  const url = new URL(href)
  url.search = ''
  url.hash = `/players/${encodeURIComponent(input.playerId)}`
  const achievement = input.chip ? ` — ${input.chip}.` : '.'
  const text = `${input.playerName} earned the ${input.name} badge on Elixir Drop${achievement}`
  return {
    title: `${input.playerName} earned ${input.name} | Elixir Drop`,
    text,
    url: url.toString(),
    copyText: `${text}\n${url.toString()}`
  }
}

export function shareBadge(input: BadgeShareInput, href = window.location.href): Promise<RunShareOutcome> {
  return shareImage(badgeSharePayload(input, href), () => renderBadgeShareCard(input), `elixir-drop-${input.slug}.png`)
}
