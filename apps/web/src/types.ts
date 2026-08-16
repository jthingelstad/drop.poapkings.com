export interface Card {
  id: number
  name: string
  elixir: number
  rarity: 'common' | 'rare' | 'epic' | 'legendary' | 'champion'
  type: 'troop' | 'building' | 'spell'
  evo: boolean
  hero: boolean
  icon: string
  iconEvo?: string
  iconHero?: string
}

export interface CardsData {
  version: string
  count: number
  cards: Card[]
}

export type InputStyle = 'keypad' | 'choice'

export interface Settings {
  inputStyle: InputStyle
  sound: boolean
  reducedMotion?: boolean
  // Richer particle FX across the games. On by default; reduced motion overrides.
  enhancedEffects?: boolean
  // Deal the pip keypad as two wide rows (1-5 over 6-9) instead of one row of
  // nine. Off by default: the single row is still the layout every player
  // learned, and this one trades vertical space for tap-target width.
  speedrunKeyboard?: boolean
}

export interface CardStat {
  seen: number
  correct: number
  missStreak: number
  lastSeen: number
  // Recall means the player produced the value from the full keypad. Choice or
  // idle-hint answers remain useful practice, but are weaker evidence of fluent
  // recall and must not graduate a card as quickly.
  recallSeen?: number
  recallCorrect?: number
  assistedSeen?: number
  assistedCorrect?: number
  // Average first-response time for unassisted recall only.
  avgMs?: number
  latencySamples?: number
}

export type CardStats = Record<string, CardStat>

export type LedgerStage = 'guided' | 'faded' | 'tracked'

export interface LedgerStats {
  checks: number
  correct: number
  assisted: number
  unassistedChecks: number
  unassistedCorrect: number
  longestSequence: number
  byStage: Record<LedgerStage, { seen: number; correct: number }>
  updatedAt?: number
}

export interface Records {
  surgeBest?: number // Surge: lowest time (ms) — lower is better
  surgeBestPace?: number[] // elapsed ms at each card of the PB run (ghost pacing)
  // Higher/Lower r3: total correct reads while the response clock tightens
  // continuously. Renamed from r2's `higherLowerBest` so its 2s-floor records
  // cannot remain as unreachable on-device targets.
  higherLowerContinuousBest?: number
  // Practice deliberately has NO record key: it is an endless, non-competitive
  // drill with no score and no personal best (see RECORD_KEYS / RecordedMode).
  survivalBest?: number // Survival: longest sudden-death streak
  // Trade: lowest time (ms) over the ten-exchange board ladder — lower is
  // better. Renamed from `tradeBest`, which deliberately orphans old on-device
  // bests: that number came off eight exchanges of randomly sized boards, so a
  // ten-round run could never beat it and the player would never see another
  // personal best (see the r2 board epoch).
  tradeLadderBest?: number
  rainBest?: number // Rain: most cards cleared — ranked; written only on server acceptance
}

export interface Profile {
  createdAt: number
  nickname?: string
  totalSessions: number
}
