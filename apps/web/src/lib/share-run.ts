import type { GameMode } from '@elixir-drop/contracts'
import { gameDisplay } from './game-metadata'

export interface RunSharePayload {
  title: string
  text: string
  url: string
  copyText: string
}

export type RunShareOutcome = 'shared' | 'copied' | 'cancelled' | 'unavailable'

export function runSharePayload(mode: GameMode, score: string, href = window.location.href): RunSharePayload {
  const game = gameDisplay(mode)
  const url = new URL(href)
  url.search = ''
  url.hash = `/${mode}`
  const text = `I scored ${score} in ${game.name} on Elixir Drop. Can you beat it?`
  return {
    title: `${game.name}: ${score} | Elixir Drop`,
    text,
    url: url.toString(),
    copyText: `${text}\n${url.toString()}`
  }
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
