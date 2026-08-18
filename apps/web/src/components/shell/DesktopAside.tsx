// Desktop aside — the letterbox margin panel. The app is ONE phone column; on a
// wide viewport that column is centered and this slim aside fills the margin
// with the things worth keeping off the phone: a Falling Cards launcher, the
// live "Recent runs" feed (polls GET /activity), the Surge season standings, a
// personal "this season" card, and the meta-page link cluster. It renders only
// alongside the letterboxed column (MobileShell gates it on the desktop layout)
// and never during a game.

import { useEffect } from 'preact/hooks'
import { signal } from '@preact/signals'
import { getLeaderboard, getActivity, type LeaderboardEntry, type ActivityEntry } from '../../lib/api'
import { scoreLabel, gameDisplay } from '../../lib/game-metadata'
import { navigate } from '../../lib/router'
import { tapFxFrom } from '../../lib/tap-fx'
import { playerProfilePath } from '../../lib/public-player'
import { player } from '../../lib/account'
import { offline } from '../../lib/api-availability'
import { startScreensaver } from '../../lib/screensaver'
import type { GameMode } from '@elixir-drop/contracts'
import PlayerAvatar from '../PlayerAvatar'
import Icon from '../Icon'
import { surgeSeasonCallout } from '../../screens/home/home-data'

const RAIL_MODE = 'surge' as const
const standings = signal<LeaderboardEntry[] | null>(null)
const standingsFailed = signal(false)
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
    if (!standings.value) {
      getLeaderboard(RAIL_MODE, 'season', ctrl.signal)
        .then((res) => {
          standings.value = res.entries
          standingsFailed.value = false
        })
        .catch(() => {
          if (!ctrl.signal.aborted) standingsFailed.value = true
        })
    }
    const pollActivity = () => {
      getActivity(8, ctrl.signal)
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

  const rows = standings.value
  const meId = player.value?.id
  const myStanding = meId ? rows?.find((r) => r.player.id === meId) : undefined
  const callout = surgeSeasonCallout(rows ?? [], myStanding?.score, meId)
  const feed = activity.value

  return (
    <aside class="ed-aside" aria-label="Elixir Drop">
      <button
        class="ed-rail-btn ed-rail-btn--saver tap-fx"
        onClick={(e) => {
          tapFxFrom(e)
          startScreensaver('nav')
        }}
      >
        <span class="tap-face">
          <Icon name="sparkles" />
          Falling Cards
        </span>
      </button>

      <section class="ed-rail-block">
        <div class="ed-rail-block__head">
          <span class="ed-rail-block__title">Season standings</span>
          <span class="ed-rail-block__tag">Surge</span>
        </div>
        <div class="ed-rail-standings">
          {disconnected && <div class="ed-rail-empty">Offline — reconnect for standings.</div>}
          {!disconnected && rows === null && !standingsFailed.value && <div class="ed-rail-empty">Loading…</div>}
          {!disconnected && standingsFailed.value && <div class="ed-rail-empty">Standings unavailable</div>}
          {!disconnected && rows?.length === 0 && <div class="ed-rail-empty">No runs yet this season</div>}
          {!disconnected &&
            rows?.slice(0, 5).map((r) => {
              const you = r.player.id === meId
              return (
                <button
                  key={r.player.id}
                  class={`ed-rail-row${you ? ' ed-rail-row--you' : ''}`}
                  onClick={() => navigate(playerProfilePath(r.player, meId))}
                >
                  <span class="ed-rail-row__rank" data-top={r.rank <= 3 ? '' : undefined}>
                    {r.rank}
                  </span>
                  <PlayerAvatar favoriteCardId={r.player.favoriteCardId} size="small" />
                  <span class="ed-rail-row__name">{you ? 'You' : r.player.publicName}</span>
                  <span class="ed-rail-row__score">{scoreLabel(RAIL_MODE, r.score)}</span>
                </button>
              )
            })}
        </div>
      </section>

      {player.value && !disconnected && (
        <button class="ed-rail-this tap-fx" onClick={() => navigate('/leaderboards')}>
          <span class="ed-rail-this__label">Your Surge season</span>
          <strong class="ed-rail-this__headline">{callout.title}</strong>
          <span class="ed-rail-this__detail">{callout.detail}</span>
          <span class="ed-rail-this__stats">
            <span>
              <span class="ed-rail-this__val">{myStanding ? `#${myStanding.rank}` : '—'}</span>
              <span class="ed-rail-this__sub">rank</span>
            </span>
            <span>
              <span class="ed-rail-this__val ed-rail-this__val--ink">
                {myStanding ? scoreLabel(RAIL_MODE, myStanding.score) : '—'}
              </span>
              <span class="ed-rail-this__sub">best</span>
            </span>
          </span>
        </button>
      )}

      <section class="ed-rail-block">
        <div class="ed-rail-live__head">
          <Icon name="clock" className="ed-rail-live__icon" />
          <span class="ed-rail-block__title">Recent runs</span>
        </div>
        <div class="ed-rail-live">
          {disconnected && <div class="ed-rail-empty">Offline — reconnect for recent runs.</div>}
          {!disconnected && feed === null && <div class="ed-rail-empty">Loading…</div>}
          {!disconnected && feed?.length === 0 && <div class="ed-rail-empty">No recent runs yet — be the first.</div>}
          {!disconnected &&
            feed?.map((a, i) => (
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

      <nav class="ed-railfoot" aria-label="About Elixir Drop">
        <a class="ed-railfoot__link" href="/about/">
          About
        </a>
        <a class="ed-railfoot__link" href="/faq/">
          FAQ
        </a>
        <a class="ed-railfoot__link" href="/fair-play/">
          Fair Play
        </a>
        <a class="ed-railfoot__link" href="/privacy/">
          Privacy
        </a>
        <a class="ed-railfoot__link" href="/discord/">
          Discord
        </a>
      </nav>
    </aside>
  )
}
