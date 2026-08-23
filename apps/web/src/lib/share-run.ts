import type { GameMode } from '@elixir-drop/contracts'
import { canShareImage } from './share-card'

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
