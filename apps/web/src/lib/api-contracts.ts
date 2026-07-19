import { z } from 'zod'
import { GAME_MODES } from '@elixir-drop/contracts'

// Drop ships a strict CSP without unsafe-eval. Disable Zod's optional JIT probe
// so Firefox does not report a security-policy violation for every API parse.
z.config({ jitless: true })

const nonEmptyString = z.string().min(1)
const isoDateTime = z.string().datetime({ offset: true })
const safeInteger = z.number().int().safe()
const nonNegativeInteger = safeInteger.nonnegative()
const cardId = safeInteger.positive()

export const apiConfigSchema = z.object({
  apiBaseUrl: z.string()
})

export const apiErrorSchema = z.object({
  error: z.optional(
    z.object({
      code: z.optional(nonEmptyString),
      message: z.optional(nonEmptyString)
    })
  )
})

export const gameModeSchema = z.enum(GAME_MODES)

export const seasonSchema = z.object({
  id: nonEmptyString,
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  durationWeeks: safeInteger.positive(),
  source: z.optional(z.enum(['clash-royale', 'calendar-fallback'])),
  crSeasonId: z.optional(nonNegativeInteger),
  currentWeek: z.optional(safeInteger.positive()),
  daysRemainingInWeek: z.optional(nonNegativeInteger),
  periodType: z.optional(z.enum(['training', 'warDay', 'colosseum'])),
  clockUpdatedAt: z.optional(isoDateTime)
})

const clashRoyaleCardSchema = z.object({
  id: cardId,
  name: nonEmptyString,
  iconUrl: z.optional(z.string().url())
})

const clashRoyaleClanSchema = z.object({
  tag: nonEmptyString,
  name: nonEmptyString,
  badgeId: nonNegativeInteger,
  role: z.optional(nonEmptyString)
})

const clashRoyaleProfileSchema = z.object({
  tag: nonEmptyString,
  status: z.enum(['pending', 'ready', 'not_found', 'unavailable']),
  name: z.optional(nonEmptyString),
  clan: z.optional(clashRoyaleClanSchema),
  accountAge: z.optional(
    z.object({
      days: z.optional(nonNegativeInteger),
      years: z.optional(nonNegativeInteger)
    })
  ),
  cards: z.optional(z.array(clashRoyaleCardSchema)),
  fetchedAt: z.optional(isoDateTime),
  refreshRequestedAt: z.optional(isoDateTime)
})

export const playerSchema = z.object({
  id: nonEmptyString,
  email: z.string().email(),
  publicName: z.optional(nonEmptyString),
  favoriteCardId: z.optional(cardId),
  playerTag: z.optional(nonEmptyString),
  clashRoyale: z.optional(clashRoyaleProfileSchema),
  totalGames: nonNegativeInteger,
  // Absent on responses from before XP shipped — default to 0.
  xp: nonNegativeInteger.default(0),
  level: safeInteger.positive(),
  levelStartGames: nonNegativeInteger,
  nextLevelGames: nonNegativeInteger,
  createdAt: isoDateTime,
  updatedAt: isoDateTime
})

const sessionSchema = z.object({
  token: nonEmptyString,
  expiresAt: isoDateTime
})

const cardSequenceChallengeSchemas = [
  z.object({ mode: z.literal('surge'), cardIds: z.array(cardId) }),
  z.object({ mode: z.literal('practice'), cardIds: z.array(cardId) }),
  z.object({ mode: z.literal('survival'), cardIds: z.array(cardId) })
] as const

export const runChallengeSchema = z.discriminatedUnion('mode', [
  ...cardSequenceChallengeSchemas,
  z.object({ mode: z.literal('higher-lower'), pairs: z.array(z.tuple([cardId, cardId])) }),
  z.object({
    mode: z.literal('trade'),
    rounds: z.array(z.object({ blueIds: z.array(cardId), redIds: z.array(cardId) }))
  })
])

export const loginRequestResponseSchema = z.object({ ok: z.literal(true), message: nonEmptyString })
export const sessionResponseSchema = z.object({ session: sessionSchema })

export const recentRunSchema = z.object({
  runId: nonEmptyString,
  mode: gameModeSchema,
  score: z.number().finite(),
  seasonId: nonEmptyString,
  completedAt: isoDateTime
})

export const learningSummarySchema = z.object({
  weakCardIds: z.array(cardId),
  costAccuracy: z.record(z.string(), z.object({ seen: nonNegativeInteger, correct: nonNegativeInteger }))
})

export const meResponseSchema = z.object({
  player: playerSchema,
  recentRuns: z.array(recentRunSchema),
  // Absent from older responses.
  learning: z.optional(learningSummarySchema)
})

export const nameOptionsResponseSchema = z.object({
  favoriteCardId: cardId,
  names: z.array(nonEmptyString).min(1),
  nameToken: nonEmptyString
})

export const playerResponseSchema = z.object({ player: playerSchema })
export const accountDeletionResponseSchema = z.object({ ok: z.literal(true) })

export const startedRunSchema = z
  .object({
    runId: nonEmptyString,
    runToken: nonEmptyString,
    mode: gameModeSchema,
    challenge: runChallengeSchema,
    // Retained for compatibility with historical unranked runs.
    ranked: z.optional(z.boolean()),
    expiresAt: isoDateTime
  })
  .refine((run) => run.mode === run.challenge.mode, { message: 'Run mode does not match its challenge.' })

const runCompletionFields = {
  runId: nonEmptyString,
  mode: gameModeSchema,
  score: z.number().finite(),
  season: seasonSchema,
  ranked: z.optional(z.boolean()),
  completedAt: isoDateTime,
  totalGames: nonNegativeInteger,
  xp: nonNegativeInteger.default(0),
  level: safeInteger.positive(),
  levelStartGames: nonNegativeInteger,
  nextLevelGames: nonNegativeInteger
}

export const completedRunSchema = z.discriminatedUnion('accepted', [
  z.object({ accepted: z.literal(true), ...runCompletionFields }),
  z.object({ accepted: z.literal(false), reviewStatus: z.literal('pending'), ...runCompletionFields })
])

export const siteStatsSchema = z.object({
  trophyRoadGames: nonNegativeInteger,
  currentSeason: seasonSchema,
  webVersion: z.optional(nonEmptyString)
})

export const leaderboardEntrySchema = z.object({
  rank: safeInteger.positive(),
  score: z.number().finite(),
  achievedAt: isoDateTime,
  // Survival: cumulative time (ms) — the tiebreak among equal streaks.
  timeMs: z.optional(nonNegativeInteger),
  player: z.object({
    id: nonEmptyString,
    publicName: nonEmptyString,
    favoriteCardId: z.optional(cardId),
    playerTag: z.optional(nonEmptyString),
    totalGames: nonNegativeInteger,
    xp: nonNegativeInteger.default(0),
    level: safeInteger.positive()
  })
})

export const leaderboardResponseSchema = z.object({
  mode: gameModeSchema,
  seasonId: nonEmptyString,
  currentSeason: seasonSchema,
  entries: z.array(leaderboardEntrySchema)
})

export type RecentRun = z.infer<typeof recentRunSchema>
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>
