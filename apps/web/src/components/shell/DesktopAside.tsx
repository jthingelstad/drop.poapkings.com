// Desktop activity rail, cut to what a phone cannot do well: one live feed.
//
// It used to carry five blocks and three of them said what the page beside them
// already said: season standings is the top five of a board one click away
// (where you get all of it plus the period rail and the seals), "Your Surge
// season" is the hero's own rank-and-best line restated, and the meta links are
// reference, not activity. A rail that repeats the page beside it makes a
// screen feel busier AND emptier at once — busier to read, emptier of anything
// new.
//
// What is left is the live feed, and only the live feed. The Falling Cards
// control went to the foot of the left rail with the meta links: the left rail
// is everything ABOUT the app, this aside is the one thing HAPPENING. That is
// why the feed earns the full height of the column and the controls do not.

import { useEffect } from 'preact/hooks'
import { signal } from '@preact/signals'
import { getActivity, type ActivityEntry } from '../../lib/api'
import { scoreLabel, gameDisplay } from '../../lib/game-metadata'
import { navigate } from '../../lib/router'
import { playerProfilePath } from '../../lib/public-player'
import { player } from '../../lib/account'
import { offline } from '../../lib/api-availability'
import type { GameMode } from '@elixir-drop/contracts'
import PlayerAvatar from '../PlayerAvatar'

// Ten rows instead of six — the room the departed Falling Cards control freed,
// now that the feed is the only thing in this column and stretches to its
// height.
const FEED_ROWS = 10

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
    </aside>
  )
}
