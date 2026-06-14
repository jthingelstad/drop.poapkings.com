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
export type ElixirMood =
  | 'neutral'
  | 'hype'
  | 'unimpressed'
  | 'celebrate'
  | 'thinking'
  | 'happy'
  | 'angry'
  | 'facepalm'
  | 'trophy'
  | 'gg'
  | 'time'

export interface Settings {
  inputStyle: InputStyle
  sound: boolean
  reducedMotion?: boolean
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
  longestStreak?: number // Higher/Lower: longest streak
  bestAccuracy?: number // Practice: best round accuracy (%)
  blitzBest?: number // Blitz: most cleared in 60s — higher is better
  survivalBest?: number // Survival: longest sudden-death streak
  deckBudgetBest?: number // Deck Budget: closest to target (smallest diff ×100) — lower is better
}

export interface Profile {
  createdAt: number
  nickname?: string
  totalSessions: number
}

export interface FunnelData {
  recruitShown: number
  recruitJoin: number
  recruitDiscord: number
  shares: number
}
