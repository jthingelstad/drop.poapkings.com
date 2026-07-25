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
  // Higher/Lower: total correct reads in a run — NOT a streak, since the run
  // now survives two misses. Renamed from the one-life era's `longestStreak`,
  // which deliberately orphans old on-device bests: a 28 set under one life
  // measured a different game (see the r2 board epoch).
  higherLowerBest?: number
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
