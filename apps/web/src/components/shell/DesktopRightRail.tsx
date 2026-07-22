// Desktop right rail: Season standings (Surge) · a "This season" personal card ·
// the "Live now" recent-activity feed (polls GET /activity). Rows link to the
// player's own profile (per-player profiles don't exist yet).

import { useEffect } from 'preact/hooks'
import { signal } from '@preact/signals'
import { getLeaderboard, getActivity, type LeaderboardEntry, type ActivityEntry } from '../../lib/api'
import { scoreLabel, gameDisplay } from '../../lib/game-metadata'
import { navigate } from '../../lib/router'
import { player } from '../../lib/account'
import type { GameMode } from '@elixir-drop/contracts'
import PlayerAvatar from '../PlayerAvatar'

const RAIL_MODE = 'surge' as const
const standings = signal<LeaderboardEntry[] | null>(null)
const standingsFailed = signal(false)
const activity = signal<ActivityEntry[] | null>(null)

// "cleared 44 in Rain" / "18 streak · Survival" / "Surge · 1.42s"
function activityAction(mode: GameMode, score: number): string {
  const name = gameDisplay(mode).name
  if (mode === 'rain') return `cleared ${score} in Rain`
  if (mode === 'survival' || mode === 'higher-lower') return `${scoreLabel(mode, score)} · ${name}`
  return `${name} · ${scoreLabel(mode, score)}`
}

function activityWhen(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`
}

export default function DesktopRightRail() {
  useEffect(() => {
    const ctrl = new AbortController()
    if (!standings.value) {
      getLeaderboard(RAIL_MODE, 'season', ctrl.signal)
        .then((res) => {
          standings.value = res.entries.slice(0, 5)
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
  }, [])

  const rows = standings.value
  const meId = player.value?.id
  const myRank = meId ? rows?.find((r) => r.player.id === meId)?.rank : undefined
  const feed = activity.value

  return (
    <>
      <section class="ed-rail-block">
        <div class="ed-rail-block__head">
          <span class="ed-rail-block__title">Season standings</span>
          <span class="ed-rail-block__tag">Surge</span>
        </div>
        <div class="ed-rail-standings">
          {rows === null && !standingsFailed.value && <div class="ed-rail-empty">Loading…</div>}
          {standingsFailed.value && <div class="ed-rail-empty">Standings unavailable</div>}
          {rows?.length === 0 && <div class="ed-rail-empty">No runs yet this season</div>}
          {rows?.map((r) => {
            const you = r.player.id === meId
            return (
              <button
                key={r.player.id}
                class={`ed-rail-row${you ? ' ed-rail-row--you' : ''}`}
                onClick={() => navigate('/profile')}
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

      {player.value && (
        <section class="ed-rail-this">
          <div class="ed-rail-this__label">This season</div>
          <div class="ed-rail-this__stats">
            <div>
              <div class="ed-rail-this__val">{myRank ? `#${myRank}` : '—'}</div>
              <div class="ed-rail-this__sub">Surge rank</div>
            </div>
            <div>
              <div class="ed-rail-this__val ed-rail-this__val--ink">{player.value.totalGames.toLocaleString()}</div>
              <div class="ed-rail-this__sub">runs</div>
            </div>
          </div>
        </section>
      )}

      <section class="ed-rail-block">
        <div class="ed-rail-live__head">
          <span class="ed-rail-live__dot" aria-hidden="true" />
          <span class="ed-rail-block__title">Live now</span>
        </div>
        <div class="ed-rail-live">
          {feed === null && <div class="ed-rail-empty">Loading…</div>}
          {feed?.length === 0 && <div class="ed-rail-empty">Quiet right now — be the first.</div>}
          {feed?.map((a, i) => (
            <button
              key={`${a.player.id}-${a.achievedAt}-${i}`}
              class="ed-rail-live__row"
              onClick={() => navigate('/profile')}
            >
              <PlayerAvatar favoriteCardId={a.player.favoriteCardId} size="small" />
              <span class="ed-rail-live__text">
                <span class="ed-rail-live__name">{a.player.id === meId ? 'You' : a.player.publicName}</span>
                <span class="ed-rail-live__action">{activityAction(a.mode, a.score)}</span>
              </span>
              <span class="ed-rail-live__when">{activityWhen(a.achievedAt)}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  )
}
