import { signal } from '@preact/signals'
import type { Player } from '@elixir-drop/contracts'
import { ApiError, deleteMe, getMe, patchMe, redeemLogin, refreshLogin, type RecentRun } from './api'

interface StoredSession {
  token: string
  expiresAt: string
}

const SESSION_KEY = 'elixirdrop:session:v1'

export const player = signal<Player | null>(null)
export const recentRuns = signal<RecentRun[]>([])
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
  return session?.token
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
    accountStatus.value = 'anonymous'
    return
  }
  try {
    const refreshed = await refreshLogin(session.token)
    saveSession(refreshed.session)
    const response = await getMe(refreshed.session.token)
    player.value = response.player
    recentRuns.value = response.recentRuns
    accountStatus.value = 'authenticated'
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      saveSession(undefined)
      player.value = null
      recentRuns.value = []
      accountStatus.value = 'anonymous'
      return
    }
    accountError.value = error instanceof Error ? error.message : 'Drop could not reconnect to player services.'
    accountStatus.value = 'unavailable'
  }
}

export async function redeemAccount(token: string): Promise<Player> {
  const response = await redeemLogin(token)
  saveSession(response.session)
  const me = await getMe(response.session.token)
  player.value = me.player
  recentRuns.value = me.recentRuns
  accountError.value = ''
  accountStatus.value = 'authenticated'
  return me.player
}

export async function updateAccount(updates: {
  publicName?: string
  favoriteCardId?: number
  nameToken?: string
  playerTag?: string | null
}): Promise<void> {
  if (!session) throw new Error('Sign in to update your player profile.')
  const response = await patchMe(session.token, updates)
  player.value = response.player
}

export async function refreshAccount(): Promise<void> {
  if (!session) return
  try {
    const response = await getMe(session.token)
    player.value = response.player
    recentRuns.value = response.recentRuns
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
  level?: number
  levelStartGames?: number
  nextLevelGames?: number
}): void {
  if (!player.value || progress.totalGames === undefined) return
  player.value = {
    ...player.value,
    totalGames: progress.totalGames,
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
  accountError.value = ''
  accountStatus.value = 'anonymous'
}
