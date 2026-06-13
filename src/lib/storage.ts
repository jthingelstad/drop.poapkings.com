// Storage seam — ALL localStorage access goes through this module.
// v2: replace the body of each function with fetch() without touching game logic.

import type { CardStats, CardStat, Records, Profile, FunnelData, Settings } from '../types'

const K = {
  profile: 'elixirdrop:profile',
  cardStats: 'elixirdrop:cardStats',
  records: 'elixirdrop:records',
  funnel: 'elixirdrop:funnel',
  settings: 'elixirdrop:settings'
} as const

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage quota exceeded — silently ignore
  }
}

// ── Profile ──────────────────────────────────────────────────────────────────

export function getProfile(): Profile {
  return load<Profile>(K.profile, { createdAt: Date.now(), totalSessions: 0 })
}

export function saveProfile(p: Partial<Profile>): void {
  save(K.profile, { ...getProfile(), ...p })
}

// Count a completed session (Practice round, Surge sprint, Higher/Lower run).
export function recordSession(): void {
  saveProfile({ totalSessions: getProfile().totalSessions + 1 })
}

// ── Card stats ────────────────────────────────────────────────────────────────

export function getCardStats(): CardStats {
  return load<CardStats>(K.cardStats, {})
}

export function saveResult(cardId: number, correct: boolean, ms?: number): void {
  const stats = getCardStats()
  const key = String(cardId)
  const prev: CardStat = stats[key] ?? { seen: 0, correct: 0, missStreak: 0, lastSeen: 0 }

  const avgMs =
    ms !== undefined
      ? prev.avgMs !== undefined
        ? Math.round((prev.avgMs * prev.seen + ms) / (prev.seen + 1))
        : ms
      : prev.avgMs

  stats[key] = {
    seen: prev.seen + 1,
    correct: prev.correct + (correct ? 1 : 0),
    missStreak: correct ? 0 : prev.missStreak + 1,
    lastSeen: Date.now(),
    ...(avgMs !== undefined ? { avgMs } : {})
  }

  save(K.cardStats, stats)
}

// ── Records ───────────────────────────────────────────────────────────────────

export function getRecords(): Records {
  return load<Records>(K.records, {})
}

export function saveRecords(r: Partial<Records>): void {
  save(K.records, { ...getRecords(), ...r })
}

// ── Settings ──────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: Settings = {
  inputStyle: 'keypad',
  sound: false,
  reducedMotion: false
}

export function getSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...load<Partial<Settings>>(K.settings, {}) }
}

export function saveSettings(s: Partial<Settings>): void {
  save(K.settings, { ...getSettings(), ...s })
}

// ── Funnel ────────────────────────────────────────────────────────────────────

export function getFunnel(): FunnelData {
  return load<FunnelData>(K.funnel, { recruitShown: 0, recruitJoin: 0, recruitDiscord: 0, shares: 0 })
}

export function saveFunnel(f: Partial<FunnelData>): void {
  save(K.funnel, { ...getFunnel(), ...f })
}
