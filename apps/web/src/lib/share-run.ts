import type { GameMode } from '@elixir-drop/contracts'

export type ShareableGameMode = Exclude<GameMode, 'practice'>

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
