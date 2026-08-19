import type { GameMode } from '@elixir-drop/contracts'
import { gameDisplay } from './game-metadata'
import { canShareImage, renderShareCard, type ShareCardInput } from './share-card'

export type ShareableGameMode = Exclude<GameMode, 'practice'>

export interface RunSharePayload {
  title: string
  text: string
  url: string
  copyText: string
}

export type RunShareOutcome = 'shared' | 'copied' | 'cancelled' | 'unavailable'

export function dropSharePayload(href = window.location.href): RunSharePayload {
  const url = new URL('/', href)
  url.search = ''
  url.hash = ''
  const text = 'Elixir Drop makes learning Clash Royale card costs feel like a game. How fast can you read the field?'
  return {
    title: 'Elixir Drop — Clash Royale Elixir Cost Trainer',
    text,
    url: url.toString(),
    copyText: `${text}\n${url.toString()}`
  }
}

export function shareDrop(href = window.location.href): Promise<RunShareOutcome> {
  return shareRun(dropSharePayload(href))
}

// `url` is the run's own permalink — a minted /#/r/<token> address. It is passed
// through verbatim rather than rebuilt from a mode: the link is what gets
// counted, and a payload that quietly rewrote it back to the mode's home page
// would leave the image travelling with a link to nowhere in particular.
export function runSharePayload(
  mode: ShareableGameMode,
  score: string,
  url: string,
  playerName?: string
): RunSharePayload {
  const game = gameDisplay(mode)
  const text = playerName
    ? `${playerName} scored ${score} in ${game.name} on Elixir Drop. Can you beat it?`
    : `I scored ${score} in ${game.name} on Elixir Drop. Can you beat it?`
  return {
    title: `${playerName ? `${playerName} · ` : ''}${game.name}: ${score} | Elixir Drop`,
    text,
    url,
    copyText: `${text}\n${url}`
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
  return shareImage(payload, () => renderShareCard(card), 'elixir-drop.png')
}

// Common image-share upgrade used by score cards and badge cards. The caller
// only owns rendering; capability checks, cancellation, and the text/clipboard
// fallback stay identical on every share surface.
export async function shareImage(
  payload: RunSharePayload,
  render: () => Promise<Blob | null>,
  filename: string
): Promise<RunShareOutcome> {
  if (!canShareImage()) return shareRun(payload)
  let file: File
  try {
    const blob = await render()
    if (!blob) return shareRun(payload)
    file = new File([blob], filename, { type: 'image/png' })
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
