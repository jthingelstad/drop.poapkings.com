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
}

export interface CardStat {
  seen: number
  correct: number
  missStreak: number
  lastSeen: number
  avgMs?: number
}

export type CardStats = Record<string, CardStat>

export interface Records {
  surgeBest?: number // Surge: lowest time (ms) — lower is better
  surgeBestPace?: number[] // elapsed ms at each card of the PB run (ghost pacing)
  longestStreak?: number // Higher/Lower: longest streak
  // Practice deliberately has NO record key: it is an endless, non-competitive
  // drill with no score and no personal best (see RECORD_KEYS / RecordedMode).
  survivalBest?: number // Survival: longest sudden-death streak
  tradeBest?: number // Trade: lowest 8-exchange read time (ms) — lower is better
  rainBest?: number // Rain: most cards cleared — ranked; written only on server acceptance
}

export interface Profile {
  createdAt: number
  nickname?: string
  totalSessions: number
}
