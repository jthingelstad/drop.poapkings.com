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
export type GameMode = 'practice' | 'surge' | 'higherlower'
export type SurgeMode = 'sprint' | 'blitz'
export type ElixirMood = 'neutral' | 'hype' | 'unimpressed'

export interface Settings {
  mode: GameMode
  inputStyle: InputStyle
  surgeMode: SurgeMode
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
  surgeBest?: number
  longestStreak?: number
  bestAccuracy?: number
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
