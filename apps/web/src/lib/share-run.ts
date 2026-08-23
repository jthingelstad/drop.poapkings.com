import type { GameMode } from '@elixir-drop/contracts'

export type ShareableGameMode = Exclude<GameMode, 'practice'>

export interface RunSharePayload {
  title: string
  text: string
  url: string
  copyText: string
}

export type RunShareOutcome = 'shared' | 'copied' | 'cancelled' | 'unavailable'

// Published runs are link-native. The published URL carries its own
// personalized unfurl image, so the browser shares exactly one portable thing:
// the URL. Browsers without a native sheet copy that same URL.
export async function shareLink(url: string): Promise<RunShareOutcome> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ url })
      return 'shared'
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError')
        return 'cancelled'
    }
  }
  try {
    if (!navigator.clipboard?.writeText) return 'unavailable'
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch {
    return 'unavailable'
  }
}

export function dropSharePayload(url: string): RunSharePayload {
  const text = 'Elixir Drop makes learning Clash Royale card costs feel like a game. How fast can you read the field?'
  return {
    title: 'Elixir Drop — Clash Royale Elixir Cost Trainer',
    text,
    url,
    copyText: `${text}\n${url}`
  }
}

export function shareDrop(url: string): Promise<RunShareOutcome> {
  return shareRun(dropSharePayload(url))
}

export async function shareRun(payload: RunSharePayload): Promise<RunShareOutcome> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: payload.title, text: payload.text, url: payload.url })
      return 'shared'
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError')
        return 'cancelled'
    }
  }

  try {
    if (!navigator.clipboard?.writeText) return 'unavailable'
    await navigator.clipboard.writeText(payload.copyText)
    return 'copied'
  } catch {
    return 'unavailable'
  }
}
