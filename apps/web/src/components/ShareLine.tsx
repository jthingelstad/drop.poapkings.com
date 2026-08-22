import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { track } from '../lib/analytics'
import { gameDisplay } from '../lib/game-metadata'
import { createShareToken } from '../lib/api'
import { sessionToken } from '../lib/account'
import { canShareImage, renderShareCard, type ShareCardInput } from '../lib/share-card'
import { runSharePayload, shareRun, type RunShareOutcome, type ShareableGameMode } from '../lib/share-run'
import Icon from './Icon'

// The share function.
//
// One tap, one native sheet, with the card already rendered as a real image so
// the player sees what their friends will. The image is what gets looked at and
// the link is what gets counted; sending either alone loses half the point.
// There is deliberately no Drop-branded picker in between — a custom modal is a
// worse copy of something the phone already does well.
//
// `10b` is the no-`navigator.share` path: the same payload unbundled into
// copy-the-link and save-the-image. Not a degraded dialog — the same two things
// the sheet offers, spelled out.
//
// A NOT-RECORDED run has no share control at all. Offline and guest runs have
// no server record, so no permalink can exist; the caller simply does not render
// this component. Absent, not disabled — a disabled button invites a tap and
// then has to explain itself.

interface Props {
  mode: ShareableGameMode
  score: string
  // The server run id. One token is minted per SHARE ACTION against it, so
  // sharing the same run twice mints two tokens — which is what makes Herald
  // countable per share rather than per run.
  runId: string
  compact?: boolean
  card?: Omit<ShareCardInput, 'mode' | 'score'>
}

function buttonLabel(outcome: RunShareOutcome | null, sharing: boolean): string {
  if (sharing) return 'Opening…'
  if (outcome === 'shared') return 'Shared'
  if (outcome === 'copied') return 'Copied'
  return 'Share this run'
}

export default function ShareLine({ mode, score, runId, compact = false, card }: Props) {
  const outcome = useSignal<RunShareOutcome | null>(null)
  const sharing = useSignal(false)
  // The unbundled payload (10b), shown only where the native sheet does not
  // exist. Held in state so the link stays copyable after the first attempt.
  const fallback = useSignal<{ url: string; imageUrl?: string } | null>(null)
  const game = gameDisplay(mode)
  // The "Shared / Copied" confirmation reverts on a timer. Hold it so leaving
  // the summary (Play again, Home) tears the timer down instead of leaving it
  // pending against an unmounted component.
  const resetTimer = useRef<number | undefined>(undefined)
  const objectUrl = useRef<string | undefined>(undefined)
  useEffect(
    () => () => {
      window.clearTimeout(resetTimer.current)
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    },
    []
  )

  // The permalink. Hash routing is the stable public share contract, so this is
  // the address a shared run actually resolves at.
  function permalink(token: string): string {
    return `${window.location.origin}/#/r/${token}`
  }

  async function share() {
    if (sharing.value) return
    sharing.value = true
    outcome.value = null

    // Mint first: the token is what makes the link countable, and a share
    // without one is a link to nowhere. If minting fails there is nothing
    // honest to send, so the button says so rather than sharing a home page.
    let url: string
    try {
      const session = sessionToken()
      if (!session) throw new Error('no session')
      const { token } = await createShareToken(runId, session, card?.series)
      url = permalink(token)
    } catch {
      sharing.value = false
      outcome.value = 'unavailable'
      return
    }

    const payload = runSharePayload(mode, score, url, card?.playerName)
    const image = await renderShareCard({ mode, score, ...card }).catch(() => null)
    const file = image && canShareImage() ? new File([image], 'elixir-drop.png', { type: 'image/png' }) : null

    if (file && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ title: payload.title, text: payload.text, url: payload.url, files: [file] })
        sharing.value = false
        outcome.value = 'shared'
        track('game.shared', mode)
        window.clearTimeout(resetTimer.current)
        resetTimer.current = window.setTimeout(() => (outcome.value = null), 1800)
        return
      } catch (error) {
        sharing.value = false
        if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError') {
          outcome.value = null
          return
        }
      }
    }

    if (typeof navigator.share === 'function') {
      const result = await shareRun(payload)
      sharing.value = false
      outcome.value = result === 'cancelled' ? null : result
      if (result === 'shared' || result === 'copied') {
        track('game.shared', mode)
        window.clearTimeout(resetTimer.current)
        resetTimer.current = window.setTimeout(() => (outcome.value = null), 1800)
      }
      return
    }

    // 10b — no native sheet. The same payload, unbundled: the link to paste and
    // the image to save.
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = image ? URL.createObjectURL(image) : undefined
    fallback.value = { url, ...(objectUrl.current ? { imageUrl: objectUrl.current } : {}) }
    sharing.value = false
    track('game.shared', mode)
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard?.writeText(url)
      outcome.value = 'copied'
      window.clearTimeout(resetTimer.current)
      resetTimer.current = window.setTimeout(() => (outcome.value = null), 1800)
    } catch {
      outcome.value = 'unavailable'
    }
  }

  const button = (
    <button class="ed-btn ed-btn--ghost shareline__btn" disabled={sharing.value} onClick={() => void share()}>
      <Icon name={outcome.value === 'shared' || outcome.value === 'copied' ? 'check' : 'share'} />
      {buttonLabel(outcome.value, sharing.value)}
    </button>
  )

  const unbundled = fallback.value && (
    <div class="shareline__unbundled">
      <div class="shareline__link">
        <span class="shareline__url">{fallback.value.url}</span>
        <button class="ed-btn ed-btn--gold shareline__copy" onClick={() => void copyLink(fallback.value!.url)}>
          {outcome.value === 'copied' ? 'Copied' : 'Copy'}
        </button>
      </div>
      {fallback.value.imageUrl && (
        <a class="shareline__save" href={fallback.value.imageUrl} download="elixir-drop.png">
          <Icon name="download" />
          Save the image
        </a>
      )}
    </div>
  )

  if (compact)
    return (
      <div class="shareline shareline--compact">
        {button}
        {unbundled}
      </div>
    )

  return (
    <div class="shareline">
      <div class="shareline__copy-block">
        <div class="ed-sum__label">Share your score</div>
        <div class="shareline__score">
          {game.name} · {score}
        </div>
        <div class="shareline__status" aria-live="polite">
          {outcome.value === 'copied' && 'Link copied.'}
          {outcome.value === 'unavailable' && 'Sharing is unavailable right now.'}
          {outcome.value === 'shared' && 'Run shared.'}
        </div>
      </div>
      {button}
      {unbundled}
    </div>
  )
}
