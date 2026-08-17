import { signal } from '@preact/signals'

const STORAGE_KEY = 'elixirdrop:playerTagNudge'
export const PLAYER_TAG_NUDGE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000
const HISTORY_RETENTION_MS = 8 * PLAYER_TAG_NUDGE_INTERVAL_MS

type NudgeHistory = Record<string, number>

let memoryHistory: NudgeHistory = {}

function readHistory(): NudgeHistory {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return memoryHistory
    const history = Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    )
    memoryHistory = { ...memoryHistory, ...history }
  } catch {
    // The in-memory history still prevents repeat prompts during this visit.
  }
  return memoryHistory
}

function writeShown(playerId: string, now: number): void {
  const cutoff = now - HISTORY_RETENTION_MS
  memoryHistory = Object.fromEntries(
    Object.entries({ ...readHistory(), [playerId]: now }).filter(([, shownAt]) => shownAt >= cutoff)
  )
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryHistory))
  } catch {
    // A storage-disabled browser still gets only one prompt this visit.
  }
}

export function isPlayerTagNudgeDue(lastShownAt: number | undefined, now: number): boolean {
  return lastShownAt === undefined || now - lastShownAt >= PLAYER_TAG_NUDGE_INTERVAL_MS
}

// Completing the required card/name setup should not immediately open another
// account task. Treat setup completion as the first reminder for this device.
export function deferPlayerTagNudge(playerId: string, now = Date.now()): void {
  writeShown(playerId, now)
}

// Holds the player for whom the prompt is open. The player id prevents a
// sign-out/account switch from carrying one player's modal into another.
export const playerTagNudgePlayerId = signal<string | null>(null)

export function openPlayerTagNudgeIfDue(playerId: string, now = Date.now()): void {
  if (playerTagNudgePlayerId.value || !isPlayerTagNudgeDue(readHistory()[playerId], now)) return
  writeShown(playerId, now)
  playerTagNudgePlayerId.value = playerId
}

export function dismissPlayerTagNudge(): void {
  playerTagNudgePlayerId.value = null
}
