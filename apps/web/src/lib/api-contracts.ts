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

const publicClashRoyaleProfileSchema = clashRoyaleProfileSchema.pick({
  tag: true,
  status: true,
  name: true,
  clan: true
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
  updatedAt: isoDateTime,
  rankedAccess: z.optional(z.enum(['allowed', 'restricted'])),
  // When the player last opened Updates (server-owned, account-level). Anything
  // newer than this is unread.
  lastOpenedUpdates: z.optional(isoDateTime)
})

const sessionSchema = z.object({
  token: nonEmptyString,
  expiresAt: isoDateTime
})

const cardSequenceChallengeSchemas = [
  z.object({ mode: z.literal('surge'), cardIds: z.array(cardId) }),
  z.object({
    mode: z.literal('practice'),
    practiceKind: z.optional(z.enum(['costs', 'ledger'])),
    cardIds: z.array(cardId)
  }),
  z.object({ mode: z.literal('survival'), cardIds: z.array(cardId) }),
  z.object({ mode: z.literal('rain'), cardIds: z.array(cardId) })
] as const

export const runChallengeSchema = z.discriminatedUnion('mode', [
  ...cardSequenceChallengeSchemas,
  z.object({ mode: z.literal('higher-lower'), pairs: z.array(z.tuple([cardId, cardId])) }),
  z.object({
    mode: z.literal('trade'),
    rounds: z.array(z.object({ blueIds: z.array(cardId), redIds: z.array(cardId) }))
  })
])

export const loginRequestResponseSchema = z.object({
  ok: z.literal(true),
  message: nonEmptyString,
  // Secret poll id for the cross-context login handoff (PWA polls for its
  // session after the emailed link is redeemed in another browser).
  pollId: z.optional(nonEmptyString)
})
export const sessionResponseSchema = z.object({ session: sessionSchema })
export const loginPollResponseSchema = z.union([
  z.object({ ready: z.literal(false) }),
  z.object({ ready: z.literal(true), session: sessionSchema })
])

export const recentRunSchema = z.object({
  runId: nonEmptyString,
  mode: gameModeSchema,
  score: z.number().finite(),
  seasonId: nonEmptyString,
  completedAt: isoDateTime,
  // Per-run XP earned (activity), for the run sheet. Practice earns none.
  xp: z.optional(nonNegativeInteger),
  // The badge slugs whose rungs this run cleared — "Rungs moved" in the sheet.
  rungs: z.optional(z.array(nonEmptyString)),
  reviewStatus: z.optional(z.enum(['pending', 'reviewed', 'excluded'])),
  reviewExplanation: z.optional(nonEmptyString),
  // This run's rank on its season board, present only on the run that holds
  // the player's placement for its mode, and only when the caller asked.
  placement: z.optional(safeInteger.positive())
})

export const learningSummarySchema = z.object({
  weakCardIds: z.array(cardId),
  costAccuracy: z.record(z.string(), z.object({ seen: nonNegativeInteger, correct: nonNegativeInteger })),
  ledger: z.optional(
    z.object({
      checks: nonNegativeInteger,
      correct: nonNegativeInteger,
      assisted: nonNegativeInteger,
      unassistedChecks: nonNegativeInteger,
      unassistedCorrect: nonNegativeInteger,
      longestSequence: nonNegativeInteger,
      byStage: z.object({
        guided: z.object({ seen: nonNegativeInteger, correct: nonNegativeInteger }),
        faded: z.object({ seen: nonNegativeInteger, correct: nonNegativeInteger }),
        tracked: z.object({ seen: nonNegativeInteger, correct: nonNegativeInteger })
      }),
      updatedAt: z.optional(isoDateTime)
    })
  )
})

export const badgeStateSchema = z.object({
  slug: nonEmptyString,
  value: z.number().finite(),
  // -1 when no rung is cleared yet.
  rungIndex: safeInteger.min(-1),
  earnedAt: z.array(isoDateTime),
  // `time` ladders only: runs landed at or under each rung.
  runsAtRung: z.optional(z.array(nonNegativeInteger))
})

export const badgeSummarySchema = z.object({
  badges: z.array(badgeStateSchema),
  // Set once, on the response that first rebuilt a player's ladders from
  // history — the client shows a single summary instead of celebrating.
  backfilled: z.optional(z.boolean())
})

export const meResponseSchema = z.object({
  player: playerSchema,
  recentRuns: z.array(recentRunSchema),
  // Absent from older responses.
  learning: z.optional(learningSummarySchema),
  badges: z.optional(badgeSummarySchema)
})

export const seasonHistorySchema = z.object({
  id: nonEmptyString,
  games: nonNegativeInteger,
  runs: z.array(recentRunSchema)
})

// Every season the player has runs in, newest first — one row each, so the
// picker and the "load the season before this" control never need the runs.
export const seasonIndexEntrySchema = z.object({
  id: nonEmptyString,
  games: nonNegativeInteger,
  // The Clash Royale season number players actually recognise. Absent when the
  // server cannot anchor the internal id to a live war clock.
  crSeasonId: z.optional(nonNegativeInteger)
})

export const seasonHistoryResponseSchema = z.object({
  // Absent on responses from before the history read was paged; the client
  // falls back to the seasons it was given.
  index: z.optional(z.array(seasonIndexEntrySchema)),
  seasons: z.array(seasonHistorySchema)
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
    // Signed-out visitors get a guest run: dealt a real signed challenge but
    // never recorded on completion.
    guest: z.optional(z.literal(true)),
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
  // The run scored and recorded, but an automatic integrity signal holds it off
  // the public board until the Fair Play Referee decides. The API has always
  // sent this; the browser dropped it, which left a held player watching a
  // recorded score never reach the leaderboard with nothing to explain why.
  underReview: z.optional(z.boolean()),
  totalGames: nonNegativeInteger,
  xp: nonNegativeInteger.default(0),
  // The per-run XP award (activity), so the summary can say "XP earned +N".
  // Practice earns 0. Absent through the API-first half of a rolling deploy.
  xpEarned: z.optional(nonNegativeInteger),
  level: safeInteger.positive(),
  levelStartGames: nonNegativeInteger,
  nextLevelGames: nonNegativeInteger,
  // Rungs this run cleared, so the summary can celebrate exactly those. Absent
  // when the run moved nothing.
  earnedBadges: z.optional(
    z.array(
      z.object({
        slug: nonEmptyString,
        rungIndex: nonNegativeInteger,
        value: z.number().finite(),
        at: isoDateTime
      })
    )
  ),
  // The complete server-owned ladder snapshot after this run. Applying it
  // immediately keeps Profile in sync without a second /me round trip.
  badges: z.optional(badgeSummarySchema)
}

// A recorded (signed-in) completion carries the full progress payload; a guest
// completion carries only the scored result and nothing recorded. The guest
// member is matched first so the recorded shape (no `guest` field) falls
// through to the full schema.
const guestRunSchema = z.object({
  accepted: z.literal(true),
  guest: z.literal(true),
  mode: gameModeSchema,
  score: z.number().finite(),
  season: seasonSchema
})

const recordedRunSchema = z.object({
  accepted: z.literal(true),
  guest: z.optional(z.literal(false)),
  ...runCompletionFields
})

export const completedRunSchema = z.union([guestRunSchema, recordedRunSchema])

export const siteStatsSchema = z.object({
  trophyRoadGames: nonNegativeInteger,
  currentSeason: seasonSchema,
  webVersion: z.optional(nonEmptyString)
})

export const publicPlayerSummarySchema = z.object({
  id: nonEmptyString,
  publicName: nonEmptyString,
  favoriteCardId: z.optional(cardId),
  playerTag: z.optional(nonEmptyString),
  totalGames: nonNegativeInteger,
  xp: nonNegativeInteger.default(0),
  level: safeInteger.positive()
})

export const publicPlayerSchema = publicPlayerSummarySchema.extend({
  clashRoyale: z.optional(publicClashRoyaleProfileSchema),
  levelStartGames: nonNegativeInteger,
  nextLevelGames: nonNegativeInteger
})

export const publicPlayerResponseSchema = z.object({
  player: publicPlayerSchema,
  recentRuns: z.array(recentRunSchema),
  // Optional through the API-first half of a rolling deploy.
  badges: z.optional(badgeSummarySchema)
})

export const leaderboardEntrySchema = z.object({
  rank: safeInteger.positive(),
  score: z.number().finite(),
  achievedAt: isoDateTime,
  // A run awaiting the referee ranks provisionally, so the row needs the run's
  // status rather than a cleared/not-cleared boolean. 'excluded' never ships in
  // a board response — an excluded run leaves the board entirely. Absent on the
  // ordinary case, a run no referee has touched: there is no status to show and
  // the row carries no mark.
  reviewStatus: z.optional(z.enum(['pending', 'reviewed'])),
  // Superseded by reviewStatus. Kept readable for one release so a browser on
  // the new build still parses a response from an API that has not deployed yet.
  refereeReviewed: z.optional(z.boolean()),
  // Survival: cumulative time (ms) — the tiebreak among equal streaks.
  timeMs: z.optional(nonNegativeInteger),
  player: publicPlayerSummarySchema
})

export const leaderboardResponseSchema = z.object({
  mode: gameModeSchema,
  // 'season' (default) is the per-season board; 'all-time' ranks best-ever;
  // 'clan' ranks best-ever among the signed-in player's current clanmates.
  // seasonId is present only for the season board.
  scope: z.optional(z.enum(['season', 'all-time', 'clan'])),
  seasonId: z.optional(nonEmptyString),
  clan: z.optional(z.object({ tag: nonEmptyString, name: nonEmptyString })),
  currentSeason: seasonSchema,
  // The period rail's chips (Boards scope only): the current season and the
  // months behind it, newest first. crSeasonId is the derived Clash Royale
  // number; absent when it cannot be derived, so the client shows the raw id.
  seasons: z.optional(z.array(z.object({ id: nonEmptyString, crSeasonId: z.optional(safeInteger.positive()) }))),
  entries: z.array(leaderboardEntrySchema)
})

// Recent ranked runs across players (desktop rail), grouped by player + mode
// over the API's rolling window. score is the group's best score and achievedAt
// is its latest run. Optional defaults keep rolling web/API deploys compatible.
export const activityEntrySchema = z.object({
  mode: gameModeSchema,
  score: z.number().finite(),
  achievedAt: isoDateTime,
  runCount: z.optional(safeInteger.positive()).default(1),
  timeMs: z.optional(nonNegativeInteger),
  player: leaderboardEntrySchema.shape.player
})

export const activityResponseSchema = z.object({
  seasonId: nonEmptyString,
  windowHours: z.optional(safeInteger.positive()).default(24),
  entries: z.array(activityEntrySchema)
})

export type RecentRun = z.infer<typeof recentRunSchema>
export type SeasonHistory = z.infer<typeof seasonHistorySchema>
export type SeasonIndexEntry = z.infer<typeof seasonIndexEntrySchema>
export type PublicPlayerSummary = z.infer<typeof publicPlayerSummarySchema>
export type PublicPlayer = z.infer<typeof publicPlayerSchema>
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>
export type ActivityEntry = z.infer<typeof activityEntrySchema>
