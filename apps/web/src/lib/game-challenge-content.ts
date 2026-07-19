import type { GameMode, RunChallenge } from '@elixir-drop/contracts'
import type { Card } from '../types'
import type { TradeRound } from './trade'
import { challengeCard, challengeCards, fullDeckSize } from './challenge-cards'

export interface PreparedChallenge<T> {
  content: T
  assets: Card[]
}

type ChallengeFor<T extends GameMode> = Extract<RunChallenge, { mode: T }>
type SequenceMode = 'surge' | 'practice' | 'survival'
type SequenceChallengeFor<T extends SequenceMode> = { mode: T; cardIds: number[] }

function invalid(label: string): never {
  throw new Error(`Drop received an invalid signed ${label} challenge.`)
}

function exactCards(ids: unknown, count: number, label: string): Card[] {
  if (!Array.isArray(ids) || ids.length !== count) invalid(label)
  const cards = challengeCards(ids)
  if (cards.length !== count) invalid(label)
  return cards
}

function sequenceChallenge<T extends SequenceMode>(
  label: string,
  count: number,
  assetLimit = count
): (challenge: SequenceChallengeFor<T>) => PreparedChallenge<Card[]> {
  return (challenge) => {
    const cards = exactCards(challenge.cardIds, count, label)
    return { content: cards, assets: cards.slice(0, assetLimit) }
  }
}

export const challengePreparers = {
  surge: sequenceChallenge<'surge'>('Surge', 15),
  practice: sequenceChallenge<'practice'>('Practice', 15),
  survival: sequenceChallenge<'survival'>('Survival', fullDeckSize, 14),
  'higher-lower': (challenge: ChallengeFor<'higher-lower'>): PreparedChallenge<Array<[Card, Card]>> => {
    if (!Array.isArray(challenge.pairs) || challenge.pairs.length !== 250) invalid('Higher or Lower')
    const pairs = challenge.pairs.map((pair) => {
      if (!Array.isArray(pair) || pair.length !== 2) invalid('Higher or Lower')
      const left = challengeCard(pair[0])
      const right = challengeCard(pair[1])
      if (!left || !right) invalid('Higher or Lower')
      return [left, right] as [Card, Card]
    })
    return { content: pairs, assets: pairs[0] ? [...pairs[0]] : [] }
  },
  trade: (challenge: ChallengeFor<'trade'>): PreparedChallenge<TradeRound[]> => {
    if (!Array.isArray(challenge.rounds) || challenge.rounds.length !== 8) invalid('Trade')
    const rounds = challenge.rounds.map((round) => {
      const blue = challengeCards(round.blueIds)
      const red = challengeCards(round.redIds)
      if (
        blue.length !== round.blueIds.length ||
        red.length !== round.redIds.length ||
        blue.length < 1 ||
        blue.length > 3 ||
        red.length < 1 ||
        red.length > 3
      ) {
        invalid('Trade')
      }
      return { blue, red }
    })
    return { content: rounds, assets: rounds.flatMap((round) => [...round.blue, ...round.red]) }
  }
} satisfies {
  [T in GameMode]: (challenge: ChallengeFor<T>) => PreparedChallenge<unknown>
}
