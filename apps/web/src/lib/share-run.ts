import type { GameMode } from '@elixir-drop/contracts'
import { gameDisplay } from './game-metadata'
import { canShareImage, renderShareCard, type ShareCardInput } from './share-card'

export interface RunSharePayload {
  title: string
  text: string
  url: string
  copyText: string
}

export type RunShareOutcome = 'shared' | 'copied' | 'cancelled' | 'unavailable'

export function runSharePayload(
  mode: GameMode,
  score: string,
  href = window.location.href,
  playerName?: string
): RunSharePayload {
  const game = gameDisplay(mode)
  const url = new URL(href)
  url.search = ''
  url.hash = `/${mode}`
  const text = playerName
    ? `${playerName} scored ${score} in ${game.name} on Elixir Drop. Can you beat it?`
    : `I scored ${score} in ${game.name} on Elixir Drop. Can you beat it?`
  return {
    title: `${playerName ? `${playerName} · ` : ''}${game.name}: ${score} | Elixir Drop`,
    text,
    url: url.toString(),
    copyText: `${text}\n${url.toString()}`
  }
}

// Share the run as a composited 1080×1350 image when the browser supports
// sharing files, and as text when it does not.
//
// The image path is strictly an upgrade: every failure — no file sharing, a
// backdrop that would not load, a canvas that refused to encode — falls through
// to exactly the text share that shipped before, with the same outcome union.
// A share button that does nothing because the compositor had a bad day is
// worse than a plain text share.
export async function shareRunCard(payload: RunSharePayload, card: ShareCardInput): Promise<RunShareOutcome> {
  if (!canShareImage()) return shareRun(payload)
  let file: File
  try {
    const blob = await renderShareCard(card)
    if (!blob) return shareRun(payload)
    file = new File([blob], 'elixir-drop.png', { type: 'image/png' })
    if (!navigator.canShare?.({ files: [file] })) return shareRun(payload)
  } catch {
    return shareRun(payload)
  }
  try {
    await navigator.share({ title: payload.title, text: payload.text, url: payload.url, files: [file] })
    return 'shared'
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError')
      return 'cancelled'
    return shareRun(payload)
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
