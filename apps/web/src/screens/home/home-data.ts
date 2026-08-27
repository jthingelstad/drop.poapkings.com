// Shared Home view-model. One hook keeps routes and data identical across the
// breakpoint while the shell changes their composition.

import { useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import type { GameMode, Season, SiteStats } from '@elixir-drop/contracts'
import { getLeaderboard, getStats, type LeaderboardEntry } from '../../lib/api'
import { bestScoresFromRuns, betterScore, RANKED_GAMES, scoreFromRecords } from '../../lib/game-metadata'
import { getRecords, getSeasonRecords } from '../../lib/storage'
import { player, recentRuns } from '../../lib/account'
import type { Records } from '../../types'

export interface HomeData {
  loading: boolean
  stats: SiteStats | null
  season: Season | null
  // All-time device/server personal bests for the evergreen All Games cards.
  personalBestScores: Partial<Record<GameMode, number>>
  // Current-season bests stay paired with current-season rank in the hero.
  bestScores: Partial<Record<GameMode, number>>
  // The signed-in player's rank on any mode's board — the hero features a
  // different game each day, so it cannot read a Surge-only rank.
  rankFor: (mode: GameMode) => number | undefined
  standingsFor: (mode: GameMode) => LeaderboardEntry[]
}

export interface SurgeSeasonCallout {
  title: string
  detail: string
  leading: boolean
}

function gapLabel(milliseconds: number): string {
  const seconds = Math.max(0.1, milliseconds / 1_000)
  return `${seconds.toFixed(1).replace(/\.0$/, '')}s`
}

export function surgeSeasonCallout(
  standings: LeaderboardEntry[],
  playerBest: number | undefined,
  playerId: string | undefined
): SurgeSeasonCallout {
  const leader = standings[0]
  const detail = '#1 in Surge wins next season’s free pass.'
  if (!leader) return { title: 'Set the first Surge time of the season', detail, leading: false }
  if (playerId && leader.player.id === playerId) {
    return { title: 'You lead the race for the free pass', detail: 'Hold #1 through the season finish.', leading: true }
  }
  if (playerBest === undefined) return { title: 'Post a Surge time to join the pass race', detail, leading: false }
  const gap = playerBest - leader.score
  if (gap <= 0) return { title: 'Your best is fast enough for the lead', detail, leading: true }
  return { title: `Get ${gapLabel(gap)} faster to take the lead`, detail, leading: false }
}

// "6d 04h" — the clock alone. One form, everywhere: hours matter on the last
// day, so they are never dropped. Returns null when there is no clock to state.
function seasonClock(season: Season | null): string | null {
  if (!season) return null
  const ms = new Date(season.endsAt).getTime() - Date.now()
  if (ms <= 0) return null
  const days = Math.floor(ms / 86_400_000)
  const hours = Math.floor((ms % 86_400_000) / 3_600_000)
  return days >= 1 ? `${days}d ${String(hours).padStart(2, '0')}h` : `${hours}h`
}

// "Season ends in 6d 04h" — the clock said in a sentence. Used where something
// else already owns the pill's subject, so the season cannot lead.
export function seasonEndsLabel(season: Season | null): string {
  if (!season) return 'Season in progress'
  const clock = seasonClock(season)
  return clock ? `Season ends in ${clock}` : 'Season ending'
}

// "Season 135 · 6d 04h" — the featured hero's pill. Players read Clash Royale
// season numbers, never retired calendar-shaped storage keys.
export function seasonPillLabel(season: Season | null): string {
  const clock = seasonClock(season)
  if (!season || !clock) return seasonEndsLabel(season)
  return `Season ${season.id} · ${clock}`
}

function mergedBestScores(season: Season | null): Partial<Record<GameMode, number>> {
  const stored: Records = season ? getSeasonRecords(season.id) : getRecords()
  const recent = bestScoresFromRuns(recentRuns.value, season?.id)
  const merged: Partial<Record<GameMode, number>> = {}
  // Ranked modes only: Practice is a drill with no score and no best, so it has
  // nothing to merge and must never surface a "best" anywhere.
  for (const game of RANKED_GAMES) {
    const storedScore = scoreFromRecords(game.mode, stored)
    const recentScore = recent[game.mode]
    if (storedScore !== undefined) merged[game.mode] = storedScore
    if (recentScore !== undefined && betterScore(game.mode, recentScore, merged[game.mode]))
      merged[game.mode] = recentScore
  }
  return merged
}

export function useHomeData(): HomeData {
  const stats = useSignal<SiteStats | null>(null)
  const boards = useSignal<Partial<Record<GameMode, LeaderboardEntry[]>>>({})
  const loading = useSignal(true)

  useEffect(() => {
    const controller = new AbortController()
    void getStats(controller.signal)
      .then((value) => (stats.value = value))
      .catch(() => undefined)
    let remainingBoards = RANKED_GAMES.length
    for (const game of RANKED_GAMES) {
      void getLeaderboard(game.mode, 'season', controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) boards.value = { ...boards.value, [game.mode]: value.entries }
        })
        .catch(() => undefined)
        .finally(() => {
          remainingBoards -= 1
          if (!controller.signal.aborted && remainingBoards === 0) loading.value = false
        })
    }
    return () => controller.abort()
  }, [boards, loading, stats])

  const season = stats.value?.currentSeason ?? null
  const meId = player.value?.id
  const personalBestScores = mergedBestScores(null)
  const bestScores = mergedBestScores(season)

  // A signed-in player's current-season score and rank are one leaderboard
  // fact. Device records and the capped recent-run feed are useful fallbacks,
  // but they can be stale when the best was set elsewhere or has fallen out of
  // recent history. Whenever Home can show a server rank, use that same row's
  // score so the pair cannot contradict the board.
  if (meId) {
    for (const game of RANKED_GAMES) {
      const playerEntry = boards.value[game.mode]?.find((entry) => entry.player.id === meId)
      if (playerEntry) bestScores[game.mode] = playerEntry.score
    }
  }

  return {
    loading: loading.value,
    stats: stats.value,
    season,
    personalBestScores,
    bestScores,
    rankFor: (mode) => (meId ? boards.value[mode]?.find((entry) => entry.player.id === meId)?.rank : undefined),
    standingsFor: (mode) => boards.value[mode] ?? []
  }
}
