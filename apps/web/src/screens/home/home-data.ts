// Shared Home view-model. Both layouts (HomeMobile / HomeDesktop) render from
// this one hook so routes + data stay identical across the breakpoint; only the
// surrounding shell/markup differs. Reuses the leaderboard + best-score helpers
// the original Home already had.

import { useEffect } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import type { GameMode, Season, SiteStats } from '@elixir-drop/contracts'
import { getLeaderboard, getStats, type LeaderboardEntry } from '../../lib/api'
import { bestScoresFromRuns, betterScore, RANKED_GAMES, scoreFromRecords, GAMES } from '../../lib/game-metadata'
import { getRecords, getSeasonRecords } from '../../lib/storage'
import { player, recentRuns } from '../../lib/account'
import type { Records } from '../../types'

export interface HomeData {
  loading: boolean
  stats: SiteStats | null
  season: Season | null
  bestScores: Partial<Record<GameMode, number>>
  boards: Partial<Record<GameMode, LeaderboardEntry[]>>
  championFor: (mode: GameMode) => LeaderboardEntry | undefined
  surgeStandings: LeaderboardEntry[]
  surgeRank: number | undefined
}

// "Season ends in 6d 04h" style pill copy. Falls back gracefully with no season.
export function seasonEndsLabel(season: Season | null, withHours = false): string {
  if (!season) return 'Season in progress'
  const ms = new Date(season.endsAt).getTime() - Date.now()
  if (ms <= 0) return 'Season ending'
  const days = Math.floor(ms / 86_400_000)
  const hours = Math.floor((ms % 86_400_000) / 3_600_000)
  if (days >= 1)
    return withHours ? `Season ends in ${days}d ${String(hours).padStart(2, '0')}h` : `Season ends in ${days}d`
  return `Season ends in ${hours}h`
}

function mergedBestScores(season: Season | null): Partial<Record<GameMode, number>> {
  const stored: Records = season ? getSeasonRecords(season.id) : getRecords()
  const recent = bestScoresFromRuns(recentRuns.value, season?.id)
  const merged: Partial<Record<GameMode, number>> = {}
  for (const game of GAMES) {
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
    void Promise.all(
      RANKED_GAMES.map((game) =>
        getLeaderboard(game.mode, 'season', controller.signal)
          .then((value) => ({ mode: game.mode, entries: value.entries }))
          .catch(() => null)
      )
    )
      .then((results) => {
        const next: Partial<Record<GameMode, LeaderboardEntry[]>> = {}
        for (const result of results) if (result) next[result.mode] = result.entries
        boards.value = next
      })
      .finally(() => {
        if (!controller.signal.aborted) loading.value = false
      })
    return () => controller.abort()
  }, [boards, loading, stats])

  const season = stats.value?.currentSeason ?? null
  const surgeStandings = boards.value.surge ?? []
  const meId = player.value?.id
  const surgeRank = meId ? surgeStandings.find((e) => e.player.id === meId)?.rank : undefined

  return {
    loading: loading.value,
    stats: stats.value,
    season,
    bestScores: mergedBestScores(season),
    boards: boards.value,
    championFor: (mode) => boards.value[mode]?.[0],
    surgeStandings,
    surgeRank
  }
}
