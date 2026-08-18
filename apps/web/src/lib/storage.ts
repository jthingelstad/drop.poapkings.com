// Storage seam — the learning-progress boundary. Every read/write of profile,
// card stats, records, season records, and settings goes through here.
// Session, analytics, and PWA-install state are deliberately owned elsewhere
// (account.ts, analytics.ts, pwa-install.ts); SPEC.md §6 is the full key
// inventory.
// v2: replace the body of each function with fetch() without touching game logic.

import type { CardStats, CardStat, LedgerStage, LedgerStats, Records, Profile, Settings } from '../types'

const K = {
  profile: 'elixirdrop:profile',
  cardStats: 'elixirdrop:cardStats',
  ledgerStats: 'elixirdrop:ledgerStats',
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

// ── Ledger stats ──────────────────────────────────────────────────────────────

export function emptyLedgerStats(): LedgerStats {
  return {
    checks: 0,
    correct: 0,
    assisted: 0,
    unassistedChecks: 0,
    unassistedCorrect: 0,
    longestSequence: 0,
    byStage: {
      guided: { seen: 0, correct: 0 },
      faded: { seen: 0, correct: 0 },
      tracked: { seen: 0, correct: 0 }
    }
  }
}

export function getLedgerStats(): LedgerStats {
  const stored = load<Partial<LedgerStats>>(K.ledgerStats, {})
  const empty = emptyLedgerStats()
  return {
    ...empty,
    ...stored,
    byStage: {
      guided: { ...empty.byStage.guided, ...stored.byStage?.guided },
      faded: { ...empty.byStage.faded, ...stored.byStage?.faded },
      tracked: { ...empty.byStage.tracked, ...stored.byStage?.tracked }
    }
  }
}

export function saveLedgerResult(result: {
  correct: boolean
  assisted: boolean
  stage: LedgerStage
  sequenceLength: number
}): LedgerStats {
  const stats = getLedgerStats()
  stats.checks += 1
  stats.correct += result.correct ? 1 : 0
  stats.assisted += result.assisted ? 1 : 0
  if (!result.assisted) {
    stats.unassistedChecks += 1
    stats.unassistedCorrect += result.correct ? 1 : 0
  }
  stats.longestSequence = Math.max(stats.longestSequence, result.sequenceLength)
  stats.byStage[result.stage].seen += 1
  stats.byStage[result.stage].correct += result.correct ? 1 : 0
  stats.updatedAt = Date.now()
  save(K.ledgerStats, stats)
  return stats
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
  enhancedEffects: true
}

export function getSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...load<Partial<Settings>>(K.settings, {}) }
}

export function saveSettings(s: Partial<Settings>): void {
  save(K.settings, { ...getSettings(), ...s })
}
