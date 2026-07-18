import { signal } from '@preact/signals'
import type { Player } from '@elixir-drop/contracts'
import { ApiError, getMe, patchMe, redeemLogin, refreshLogin } from './api'

interface StoredSession {
  token: string
  expiresAt: string
}

const SESSION_KEY = 'elixirdrop:session:v1'

export const player = signal<Player | null>(null)
export const accountStatus = signal<'loading' | 'anonymous' | 'authenticated'>('loading')
let session: StoredSession | undefined

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
  if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value))
  else localStorage.removeItem(SESSION_KEY)
}

export function sessionToken(): string | undefined {
  return session?.token
}

export async function initializeAccount(): Promise<void> {
  session = loadSession()
  if (!session) {
    accountStatus.value = 'anonymous'
    return
  }
  try {
    const refreshed = await refreshLogin(session.token)
    saveSession(refreshed.session)
    const response = await getMe(refreshed.session.token)
    player.value = response.player
    accountStatus.value = 'authenticated'
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) saveSession(undefined)
    accountStatus.value = 'anonymous'
  }
}

export async function redeemAccount(token: string): Promise<void> {
  const response = await redeemLogin(token)
  saveSession(response.session)
  const me = await getMe(response.session.token)
  player.value = me.player
  accountStatus.value = 'authenticated'
}

export async function updateAccount(updates: {
  publicName?: string | null
  nameToken?: string
  playerTag?: string | null
}): Promise<void> {
  if (!session) throw new Error('Sign in to update your player profile.')
  const response = await patchMe(session.token, updates)
  player.value = response.player
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

export function signOut(): void {
  saveSession(undefined)
  player.value = null
  accountStatus.value = 'anonymous'
}
