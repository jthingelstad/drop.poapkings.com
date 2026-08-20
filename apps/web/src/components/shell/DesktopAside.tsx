// Desktop activity rail, cut to what a phone cannot do well: one live feed plus
// the Falling Cards panel-hiding control.
//
// It used to carry five blocks and three of them said what the page beside them
// already said: season standings is the top five of a board one click away
// (where you get all of it plus the period rail and the seals), "Your Surge
// season" is the hero's own rank-and-best line restated, and the meta links now
// live in You · Account, which was the point of gathering them there. A rail
// that repeats the page beside it makes a screen feel busier AND emptier at
// once — busier to read, emptier of anything new.
//
// What is left is the live feed, given real room, and the Falling Cards
// control. The feed is the only genuinely ambient, lean-back surface in the app
// and the only reason to have a desktop at all beyond reading. The aside is
// short now, and that is correct.

import { useEffect } from 'preact/hooks'
import { signal } from '@preact/signals'
import { getActivity, type ActivityEntry } from '../../lib/api'
import { scoreLabel, gameDisplay } from '../../lib/game-metadata'
import { navigate } from '../../lib/router'
import { tapFxFrom } from '../../lib/tap-fx'
import { playerProfilePath } from '../../lib/public-player'
import { player } from '../../lib/account'
import { offline } from '../../lib/api-availability'
import { cycleDesktopFallingCards, desktopFallingCardsMode } from '../../lib/screensaver'
import type { GameMode } from '@elixir-drop/contracts'
import PlayerAvatar from '../PlayerAvatar'
import Icon from '../Icon'

// Six rows instead of a scrollbar — the room the three deleted blocks freed.
const FEED_ROWS = 6

const activity = signal<ActivityEntry[] | null>(null)

function activityAction(mode: GameMode, score: number, runCount: number): string {
  const name = gameDisplay(mode).name
  const result = scoreLabel(mode, score)
  return runCount > 1 ? `${name} · ${runCount} runs · best ${result}` : `${name} · ${result}`
}

function activityWhen(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`
}

export default function DesktopAside() {
  const disconnected = offline.value
  const fallingCardsOff = desktopFallingCardsMode.value === 'off'
  useEffect(() => {
    if (disconnected) return
    const ctrl = new AbortController()
    const pollActivity = () => {
      getActivity(FEED_ROWS, ctrl.signal)
        .then((res) => (activity.value = res.entries))
        .catch(() => undefined)
    }
    pollActivity()
    const timer = window.setInterval(pollActivity, 20_000)
    return () => {
      ctrl.abort()
      window.clearInterval(timer)
    }
  }, [disconnected])

  const meId = player.value?.id
  const feed = activity.value

  return (
    <aside class="ed-aside" aria-label="Elixir Drop">
      <section class="ed-rail-block">
        <div class="ed-rail-live__head">
          <span class="ed-rail-live__pulse" aria-hidden="true" />
          <span class="ed-rail-block__title">Live · recent runs</span>
        </div>
        <div class="ed-rail-live">
          {disconnected && <div class="ed-rail-empty">Offline — reconnect for recent runs.</div>}
          {!disconnected && feed === null && <div class="ed-rail-empty">Loading…</div>}
          {!disconnected && feed?.length === 0 && <div class="ed-rail-empty">No recent runs yet — be the first.</div>}
          {!disconnected &&
            feed?.slice(0, FEED_ROWS).map((a, i) => (
              <button
                key={`${a.player.id}-${a.achievedAt}-${i}`}
                class="ed-rail-live__row"
                onClick={() => navigate(playerProfilePath(a.player, meId))}
              >
                <PlayerAvatar favoriteCardId={a.player.favoriteCardId} size="small" />
                <span class="ed-rail-live__text">
                  <span class="ed-rail-live__name">{a.player.id === meId ? 'You' : a.player.publicName}</span>
                  <span class="ed-rail-live__action">{activityAction(a.mode, a.score, a.runCount)}</span>
                </span>
                <span class="ed-rail-live__when">{activityWhen(a.achievedAt)}</span>
              </button>
            ))}
        </div>
      </section>

      <button
        class="ed-rail-btn ed-rail-btn--saver tap-fx"
        aria-label={`Falling Cards — ${fallingCardsOff ? 'background' : 'full screen'}`}
        onClick={(e) => {
          tapFxFrom(e)
          cycleDesktopFallingCards()
        }}
      >
        <span class="tap-face">
          <Icon name="sparkles" />
          Falling Cards
          <span class="ed-rail-btn__hint">{fallingCardsOff ? 'Background →' : 'Full screen →'}</span>
        </span>
      </button>
    </aside>
  )
}
