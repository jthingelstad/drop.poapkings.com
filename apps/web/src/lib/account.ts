import { signal } from '@preact/signals'
import type { Player } from '@elixir-drop/contracts'
import type { BadgeState } from './badges'
import { ApiError, deleteMe, getMe, patchMe, redeemLogin, redeemLoginCode, refreshLogin, type RecentRun } from './api'

interface StoredSession {
  token: string
  expiresAt: string
}

const SESSION_KEY = 'elixirdrop:session:v1'

export const player = signal<Player | null>(null)
export const recentRuns = signal<RecentRun[]>([])
// Server-owned badge ladders, refreshed with the rest of /me. Empty for a
// signed-out player: badges are per-account and there is nothing to show.
export const badges = signal<BadgeState[]>([])
// True on the one response that rebuilt a player's ladders from history, so the
// UI can show a single "here's what you've already earned" summary instead of
// queueing forty celebrations.
export const badgesBackfilled = signal(false)
export type AccountStatus = 'loading' | 'anonymous' | 'authenticated' | 'unavailable'
export const accountStatus = signal<AccountStatus>('loading')
export const accountError = signal('')
let session: StoredSession | undefined
let initialization: Promise<void> | undefined

function loadSession(): StoredSession | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') as StoredSession | null
    if (!value?.token || new Date(value.expiresAt).getTime() <= Date.now()) return undefined
    return value
  } catch {
    return undefined
  }
}

function saveSession(value: StoredSession | undefined): void {
  session = value
  try {
    if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // Keep the in-memory session usable when browser storage is unavailable.
  }
}

export function sessionToken(): string | undefined {
  // Shared-run routes render before the account refresh gate so anyone can
  // open them. Honor a still-valid stored session during that first render;
  // otherwise the sharer's own direct-link load could be counted as reach.
  return session?.token ?? loadSession()?.token
}

export function requiredSessionToken(): string {
  if (!session?.token) throw new ApiError(401, 'authentication_required', 'Sign in to play.')
  return session.token
}

export function initializeAccount(): Promise<void> {
  initialization ??= initializeAccountOnce().finally(() => {
    initialization = undefined
  })
  return initialization
}

async function initializeAccountOnce(): Promise<void> {
  accountError.value = ''
  accountStatus.value = 'loading'
  const storedSession = loadSession()
  if (storedSession) session = storedSession
  else if (!session || new Date(session.expiresAt).getTime() <= Date.now()) session = undefined
  if (!session) {
    player.value = null
    recentRuns.value = []
    badges.value = []
    accountStatus.value = 'anonymous'
    return
  }
  try {
    const refreshed = await refreshLogin(session.token)
    saveSession(refreshed.session)
    const response = await getMe(refreshed.session.token)
    player.value = response.player
    recentRuns.value = response.recentRuns
    applyBadgeSummary(response.badges)
    accountStatus.value = 'authenticated'
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      saveSession(undefined)
      player.value = null
      recentRuns.value = []
      badges.value = []
      accountStatus.value = 'anonymous'
      return
    }
    accountError.value = error instanceof Error ? error.message : 'Drop could not reconnect to player services.'
    accountStatus.value = 'unavailable'
  }
}

async function hydrateSession(newSession: StoredSession): Promise<Player> {
  saveSession(newSession)
  const me = await getMe(newSession.token)
  player.value = me.player
  recentRuns.value = me.recentRuns
  applyBadgeSummary(me.badges)
  accountError.value = ''
  accountStatus.value = 'authenticated'
  return me.player
}

export async function redeemAccount(token: string): Promise<Player> {
  const response = await redeemLogin(token)
  return hydrateSession(response.session)
}

export async function redeemCodeAccount(email: string, code: string): Promise<Player> {
  const response = await redeemLoginCode(email, code)
  return hydrateSession(response.session)
}

// Adopt a session handed back by the cross-context login poll (see
// lib/api.pollLogin): the emailed link was redeemed in another browser and the
// server relayed the session to this waiting client.
export async function applyPolledSession(newSession: StoredSession): Promise<Player> {
  return hydrateSession(newSession)
}

export async function updateAccount(updates: {
  publicName?: string
  favoriteCardId?: number
  nameToken?: string
  playerTag?: string | null
  lastOpenedUpdates?: string
}): Promise<void> {
  if (!session) throw new Error('Sign in to update your player profile.')
  const response = await patchMe(session.token, updates)
  player.value = response.player
  if (response.badges) applyBadgeSummary(response.badges)
}

// Stamp the Updates view as read. The server owns the clock (the value sent is
// only the trigger), and the refreshed player carries the new lastOpenedUpdates
// so the unread dot clears everywhere at once. Best-effort: a failed write just
// leaves the dot for next time.
export async function markUpdatesOpened(): Promise<void> {
  if (!session || !player.value) return
  try {
    await updateAccount({ lastOpenedUpdates: new Date().toISOString() })
  } catch {
    // The dot simply stays until the next successful open.
  }
}

export async function refreshAccount(): Promise<void> {
  if (!session) return
  try {
    const response = await getMe(session.token)
    player.value = response.player
    recentRuns.value = response.recentRuns
    applyBadgeSummary(response.badges)
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) signOut()
    throw error
  }
}

export async function deleteAccount(confirmation: string): Promise<void> {
  if (!session) throw new Error('Sign in to delete your player account.')
  await deleteMe(session.token, confirmation)
  signOut()
}

export function applyRunProgress(progress: {
  totalGames?: number
  xp?: number
  level?: number
  levelStartGames?: number
  nextLevelGames?: number
}): void {
  if (!player.value || progress.totalGames === undefined) return
  player.value = {
    ...player.value,
    totalGames: progress.totalGames,
    xp: progress.xp ?? player.value.xp,
    level: progress.level ?? player.value.level,
    levelStartGames: progress.levelStartGames ?? player.value.levelStartGames,
    nextLevelGames: progress.nextLevelGames ?? player.value.nextLevelGames
  }
}

export function recordRecentRun(run: RecentRun): void {
  recentRuns.value = [run, ...recentRuns.value.filter((recent) => recent.runId !== run.runId)].slice(0, 20)
}

export function signOut(): void {
  saveSession(undefined)
  player.value = null
  recentRuns.value = []
  badges.value = []
  accountError.value = ''
  accountStatus.value = 'anonymous'
}

export function applyBadgeSummary(summary: { badges: BadgeState[]; backfilled?: boolean } | undefined): void {
  badges.value = summary?.badges ?? []
  // Latches on: the flag only rides the one response that did the rebuild, and
  // the UI needs it to survive until it has been shown.
  if (summary?.backfilled) badgesBackfilled.value = true
}
