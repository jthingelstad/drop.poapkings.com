import type { BadgeTier } from '@elixir-drop/contracts'
import { createInviteShareToken } from './api'
import { sessionToken } from './account'
import { renderBadgeShareCard } from './share-card'
import { sharePermalink } from './share-links'
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

export function badgeSharePayload(input: BadgeShareInput, url: string): RunSharePayload {
  const achievement = input.chip ? ` — ${input.chip}.` : '.'
  const text = `${input.playerName} earned the ${input.name} badge on Elixir Drop${achievement}`
  return {
    title: `${input.playerName} earned ${input.name} | Elixir Drop`,
    text,
    url,
    copyText: `${text}\n${url}`
  }
}

export async function shareBadge(input: BadgeShareInput, href = window.location.href): Promise<RunShareOutcome> {
  const session = sessionToken()
  if (!session) return 'unavailable'
  try {
    const { token } = await createInviteShareToken('player', session, input.playerId)
    const url = sharePermalink('s', token, href)
    return shareImage(badgeSharePayload(input, url), () => renderBadgeShareCard(input), `elixir-drop-${input.slug}.png`)
  } catch {
    return 'unavailable'
  }
}
