// One-time overlay announcing a named release the player has not seen, linking
// to the full /releases history. State and the decision live in
// lib/release-notice.ts; this file is only the dialog.
//
// Deliberately not the UpdateBanner (that one means "this tab is stale,
// reload"). It never appears on a first visit, never during a game, and never
// again once dismissed.

import { useLayoutEffect, useRef } from 'preact/hooks'
import { dismissRelease, pendingRelease } from '../lib/release-notice'
import type { ReleaseEntry } from '../lib/releases'
import { route } from '../lib/router'
import { isGameRoute } from './shell/nav'
import Icon from './Icon'

const FOCUSABLE = 'a[href], button:not([disabled])'

function ReleaseDialog({ release }: { release: ReleaseEntry }) {
  const cardRef = useRef<HTMLDivElement>(null)

  // Layout effect, not a plain effect (Screensaver precedent): the trap and the
  // Escape handler must be attached with the overlay's first paint, or a key
  // pressed in that first frame falls through to the page behind it.
  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    document.body.classList.add('modal-open')

    // Focus the dialog itself rather than its first control, so the name and
    // headline are announced before the buttons and no stray ring lands on the
    // close X. Tab then walks into the controls normally.
    card.focus()

    const focusable = () => [...card.querySelectorAll<HTMLElement>(FOCUSABLE)]

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        dismissRelease()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      const start = items[0]
      const end = items[items.length - 1]
      if (!start || !end) return
      // -1 covers the dialog container and anything outside: Tab enters at the
      // top, Shift+Tab enters at the bottom, and both ends wrap.
      const at = items.indexOf(document.activeElement as HTMLElement)
      if (event.shiftKey && at <= 0) {
        event.preventDefault()
        end.focus()
      } else if (!event.shiftKey && (at === -1 || at === items.length - 1)) {
        event.preventDefault()
        start.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.classList.remove('modal-open')
      previouslyFocused?.focus?.()
    }
  }, [])

  return (
    <div
      class="release-notice"
      data-testid="release-notice"
      onClick={(event) => {
        if (event.target === event.currentTarget) dismissRelease()
      }}
    >
      <div
        class="release-notice__card"
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="release-notice-title"
        aria-describedby="release-notice-lede"
        tabIndex={-1}
      >
        <button class="release-notice__x" aria-label="Dismiss" onClick={dismissRelease}>
          <Icon name="x" />
        </button>
        <div class="release-notice__eyebrow">New release</div>
        <h2 class="release-notice__title" id="release-notice-title">
          {release.name}
        </h2>
        <p class="release-notice__lede" id="release-notice-lede">
          {release.headline}
        </p>
        <div class="release-notice__actions">
          <a class="btn btn--gold btn--sm" href="/releases/" onClick={dismissRelease}>
            See what&rsquo;s new
          </a>
          <button class="btn btn--ghost btn--sm" onClick={dismissRelease}>
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ReleaseNotice() {
  const release = pendingRelease.value
  // Never interrupt play. The notice is not dropped, only held: it appears once
  // the player is back off a game route.
  if (!release || isGameRoute(route.value)) return null
  return <ReleaseDialog release={release} />
}
