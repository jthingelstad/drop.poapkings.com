// Storage seam — the learning-progress boundary. Every read/write of profile,
// card stats, records, season records, and settings goes through here.
// Session, analytics, and PWA-install state are deliberately owned elsewhere
// (account.ts, analytics.ts, pwa-install.ts); SPEC.md §6 is the full key
// inventory.
// v2: replace the body of each function with fetch() without touching game logic.

import type { CardStats, CardStat, Records, Profile, Settings } from '../types'

const K = {
  profile: 'elixirdrop:profile',
  cardStats: 'elixirdrop:cardStats',
  records: 'elixirdrop:records',
  seasonRecords: 'elixirdrop:seasonRecords',
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

// Count a completed learning session; currently used by Practice rounds.
export function recordSession(): void {
  saveProfile({ totalSessions: getProfile().totalSessions + 1 })
}

// ── Card stats ────────────────────────────────────────────────────────────────

export function getCardStats(): CardStats {
  return load<CardStats>(K.cardStats, {})
}

export function saveResult(cardId: number, correct: boolean, ms?: number, assisted = false): void {
  const stats = getCardStats()
  const key = String(cardId)
  const prev: CardStat = stats[key] ?? { seen: 0, correct: 0, missStreak: 0, lastSeen: 0 }

  const latencySamples = prev.latencySamples ?? (prev.avgMs !== undefined ? prev.seen : 0)
  const avgMs =
    ms !== undefined && !assisted
      ? prev.avgMs !== undefined
        ? Math.round((prev.avgMs * latencySamples + ms) / (latencySamples + 1))
        : ms
      : prev.avgMs

  stats[key] = {
    seen: prev.seen + 1,
    correct: prev.correct + (correct ? 1 : 0),
    missStreak: correct ? 0 : prev.missStreak + 1,
    lastSeen: Date.now(),
    recallSeen: (prev.recallSeen ?? prev.seen) + (assisted ? 0 : 1),
    recallCorrect: (prev.recallCorrect ?? prev.correct) + (!assisted && correct ? 1 : 0),
    assistedSeen: (prev.assistedSeen ?? 0) + (assisted ? 1 : 0),
    assistedCorrect: (prev.assistedCorrect ?? 0) + (assisted && correct ? 1 : 0),
    ...(avgMs !== undefined ? { avgMs } : {}),
    ...(!assisted && ms !== undefined ? { latencySamples: latencySamples + 1 } : {})
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

// ── Season records ────────────────────────────────────────────────────────────
// Personal bests scoped to the current Clan Wars season (identified by the
// server's season id on each recorded completion). A new season id resets the
// slate — a fresh "season best" chase every four weeks.

interface SeasonRecords {
  seasonId: string
  records: Records
}

export function getSeasonRecords(seasonId: string): Records {
  const stored = load<SeasonRecords | null>(K.seasonRecords, null)
  return stored && stored.seasonId === seasonId ? stored.records : {}
}

export function saveSeasonRecord(seasonId: string, records: Partial<Records>): void {
  save(K.seasonRecords, {
    seasonId,
    records: { ...getSeasonRecords(seasonId), ...records }
  } satisfies SeasonRecords)
}

// ── Settings ──────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: Settings = {
  inputStyle: 'keypad',
  sound: false,
  reducedMotion: false,
  enhancedEffects: true,
  speedrunKeyboard: false
}

export function getSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...load<Partial<Settings>>(K.settings, {}) }
}

export function saveSettings(s: Partial<Settings>): void {
  save(K.settings, { ...getSettings(), ...s })
}
