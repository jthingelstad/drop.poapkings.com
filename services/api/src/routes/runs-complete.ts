import { arenaForXp, type XpAward } from "@elixir-drop/contracts";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  advanceBadges,
  BADGE_COUNTERS_VERSION,
  badgeStates,
  emptyCounters,
  hiddenSignals,
  localStamp,
  migrateBadgeCounters,
} from "../badges.js";
import {
  completedGameWebhookPayload,
  publishDiscordEvent,
} from "../discord.js";
import {
  buttondownPlayerMetadata,
  updateButtondownSubscriberMetadata,
} from "../buttondown.js";
import { badRequest, HttpError } from "../errors.js";
import { isGameMode } from "../games.js";
import { json } from "../http.js";
import { assessRunIntegrity } from "../integrity.js";
import { cardResultsFromTranscript, mergeCardStats } from "../learning.js";
import { levelForGames } from "../progression.js";
import { buildEvidenceItem, deriveCorrelation } from "../referee-evidence.js";
import type { Repository, RunItem } from "../repository.js";
import {
  higherLowerTiebreaks,
  rainTiebreaks,
  scoreRun,
  scoreRunWithSignals,
  survivalTimeMs,
} from "../scoring.js";
import { seasonForDate } from "../seasons.js";
import { verifyToken } from "../signing.js";
import { analyzeTimingEvidence } from "../timing-evidence.js";
import { publishTinylyticsEvent } from "../tinylytics.js";
import type {
  Correlation,
  PlayerProfile,
  RunTiebreaks,
  RunTranscript,
} from "../types.js";
import { requireObject } from "../validation.js";
import { awardRunBonuses, settleBadgeXp } from "../xp-awards.js";
import { runXp, runXpAward } from "../xp.js";
import {
  bodyOf,
  clientIpHash,
  currentWarClock,
  type RouteContext,
  sessionFor,
} from "./context.js";

type Season = ReturnType<typeof seasonForDate>;

// POST /runs/complete — validate, score, record, and publish one finished run.
//
// The flow, in order: rate limit → identify the run → guest short-circuit →
// ownership + replay + expiry → score (evidence on rejection) → integrity
// verdict → record → best-effort follow-ups (learning stats, all-time best,
// referee evidence, Discord).
export async function completeRun({ event, config, repository }: RouteContext) {
  const body = bodyOf(event);
  // Rate-limit per IP FIRST so a signed-out (guest) completion is covered
  // exactly like a signed-in one.
  await repository.useRateLimit(
    "run-complete",
    clientIpHash(event),
    300,
    60 * 60,
  );
  // Optional session: a guest completion carries no bearer token.
  const session = sessionFor(event, config.sessionSecret, false);
  if (typeof body.runToken !== "string")
    throw new HttpError(400, "A signed run token is required.");
  let claims;
  try {
    claims = verifyToken(body.runToken, "run", config.sessionSecret);
  } catch {
    throw new HttpError(
      401,
      "This run token is invalid or expired.",
      "invalid_run_token",
    );
  }
  const run = await repository.getRun(claims.runId);
  if (!run || run.owner !== claims.owner || run.mode !== claims.mode) {
    throw new HttpError(
      409,
      "This run was already recorded or is no longer valid.",
      "run_conflict",
    );
  }
  // A guest run is scored (validated + computed) but never recorded: no
  // owner/session check, no integrity gate, no completeRun, XP, leaderboard,
  // all-time, Discord, or learning stats. The run row simply TTL-expires.
  if (run.guest === true || claims.guest === true)
    return completeGuestRun(event, repository, run, body);
  // From here the run is a recorded, signed-in run: it requires a valid
  // session that owns the run.
  if (!session)
    throw new HttpError(401, "Sign in to continue.", "authentication_required");
  if (session.sub !== run.owner)
    throw new HttpError(
      403,
      "This run belongs to another player.",
      "run_owner_mismatch",
    );
  if (run.state === "completed") return replayCompletedRun(repository, run);
  const nowSeconds = Math.floor(Date.now() / 1_000);
  if (run.expiresAt <= nowSeconds)
    throw new HttpError(
      410,
      "This run expired before it was completed.",
      "run_expired",
    );
  return recordSignedInRun({ event, config, repository }, run, body);
}

// A guest completion: scored and returned, never written down.
async function completeGuestRun(
  event: APIGatewayProxyEventV2,
  repository: Repository,
  run: RunItem,
  body: Record<string, unknown>,
) {
  const nowSeconds = Math.floor(Date.now() / 1_000);
  if (run.expiresAt <= nowSeconds)
    throw new HttpError(
      410,
      "This run expired before it was completed.",
      "run_expired",
    );
  let score: number;
  const wallElapsedMs = Date.now() - new Date(run.startedAt).getTime();
  try {
    const transcript = requireObject(body.transcript ?? {}) as RunTranscript;
    score = scoreRun(run.challenge, transcript, wallElapsedMs);
  } catch (error) {
    console.warn("Guest run completion rejected by scorer", {
      requestId: event.requestContext.requestId,
      runId: run.runId,
      mode: run.mode,
      wallElapsedMs,
      reason: error instanceof Error ? error.message : "unknown",
    });
    throw badRequest(error);
  }
  const season = seasonForDate(new Date(), await currentWarClock(repository));
  return json(200, {
    accepted: true,
    guest: true,
    mode: run.mode,
    score,
    season,
  });
}

// A retry of an already-recorded run replays the stored result rather than
// scoring (and charging) the same game twice.
async function replayCompletedRun(repository: Repository, run: RunItem) {
  if (!run.completedAt || typeof run.score !== "number" || !run.seasonId)
    throw new HttpError(
      409,
      "This run was already recorded but its result is unavailable.",
      "run_conflict",
    );
  const profile = await repository.getProfile(run.owner);
  if (!profile)
    throw new HttpError(
      404,
      "Player profile was not found.",
      "profile_not_found",
    );
  const season = seasonForDate(
    new Date(run.completedAt),
    await currentWarClock(repository),
  );
  const progress = levelForGames(profile.totalGames);
  return json(200, {
    accepted: true,
    runId: run.runId,
    mode: run.mode,
    score: run.score,
    season: { ...season, id: run.seasonId },
    ranked: run.ranked !== false,
    completedAt: run.completedAt,
    totalGames: profile.totalGames,
    xp: profile.xp ?? 0,
    ...progress,
  });
}

async function recordSignedInRun(
  { event, config, repository }: RouteContext,
  run: RunItem,
  body: Record<string, unknown>,
) {
  // Complete-time correlation hashes, derived and the raw IP/user-agent
  // discarded. A start/complete mismatch is itself a referee signal.
  const completeCorrelation = deriveCorrelation(
    config.telemetryPepper,
    event.requestContext.http.sourceIp,
    event.headers["user-agent"],
  );
  const wallElapsedMs = Date.now() - new Date(run.startedAt).getTime();
  // The season is resolved before scoring so a rejected run's evidence can be
  // filed against the season it was attempted in.
  const season = seasonForDate(new Date(), await currentWarClock(repository));
  const scored = await scoreOrFileRejection(
    { event, config, repository },
    run,
    body,
    season,
    wallElapsedMs,
    completeCorrelation,
  );
  const { score, transcript, scoringReviewSignals } = scored;

  const timing = analyzeTimingEvidence(run.mode, transcript);
  const tiebreaks = modeTiebreaks(run, transcript, score);
  const leaderReviewSignals: string[] = [];
  if (run.ranked !== false) {
    try {
      if (
        await repository.wouldLeadSeason(run.mode, season.id, score, tiebreaks)
      )
        leaderReviewSignals.push("new_season_leader_pending_review");
      if (await repository.wouldLeadAllTime(run.mode, score, tiebreaks))
        leaderReviewSignals.push("new_all_time_leader_pending_review");
    } catch (error) {
      console.warn("Leader review check failed closed", {
        runId: run.runId,
        mode: run.mode,
        error: error instanceof Error ? error.name : "unknown",
      });
      leaderReviewSignals.push("leader_review_check_unavailable");
    }
  }

  const integrity = assessRunIntegrity(
    run.mode,
    score,
    wallElapsedMs,
    Array.isArray(transcript.answers) ? transcript.answers.length : undefined,
  );
  const automaticReviewSignals = [
    ...scoringReviewSignals,
    ...timing.reviewSignals,
    ...leaderReviewSignals,
    ...(!integrity.eligible ? [integrity.reason] : []),
  ];
  const automaticReviewReason =
    automaticReviewSignals.length && run.ranked !== false
      ? automaticReviewSignals.join(",")
      : undefined;
  if (!integrity.eligible && run.ranked === false) {
    throw new HttpError(
      400,
      "This game could not be verified and was not recorded.",
      "integrity_rejected",
    );
  }
  if (automaticReviewReason) {
    // The signed evidence produced a deterministic candidate score, so
    // preserve the exact run and quarantine it from public rankings. This
    // makes a false positive reversible while preventing a suspicious score
    // from appearing before referee review.
    console.warn("Run completion quarantined by integrity check", {
      requestId: event.requestContext.requestId,
      runId: run.runId,
      mode: run.mode,
      score,
      reason: automaticReviewReason,
      signals: automaticReviewSignals,
      wallElapsedMs,
    });
  }
  const answerCount = Array.isArray(transcript.answers)
    ? transcript.answers.length
    : 0;
  // Every ranked mode is determined by its validated score. Practice is the
  // one stateful award: Repository folds these cards into the player's durable
  // odd-card carry in the same transaction as the run, so 1 + 1 cards across
  // two sessions still earn exactly one XP.
  const completionXp =
    run.mode === "practice"
      ? { practiceCards: answerCount }
      : runXp(run.mode, score);
  const result = await repository.completeRun(
    { ...run, answerCount },
    score,
    season.id,
    completionXp,
    tiebreaks,
    automaticReviewReason,
  );
  const baseXp =
    result.xpAward ?? (typeof completionXp === "number" ? completionXp : 0);
  const xpAwards: XpAward[] = baseXp ? [runXpAward(run.mode, baseXp)] : [];
  await updateLearningStats(repository, run, transcript, result.completedAt);
  // Best-effort all-time best per mode, outside the completeRun transaction so
  // a "not a new best" no-op can never roll back the recorded run. Ranked
  // only; Practice keeps no board.
  let personalBest: { improved: boolean; previousScore?: number } = {
    improved: false,
  };
  if (run.ranked !== false) {
    try {
      const bestUpdate = await repository.updateAllTimeBest(
        run,
        score,
        tiebreaks,
        result.completedAt,
      );
      // Keep completion side effects fail-open if an older repository adapter
      // returns no result. The production repository always returns the typed
      // outcome, but analytics and badges must not turn a recorded run into a
      // 500 when a test or recovery adapter only performs the write.
      if (bestUpdate) personalBest = bestUpdate;
    } catch (error) {
      console.warn("All-time best update failed", {
        runId: run.runId,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
    // Referee evidence for every recorded ranked run, including runs that the
    // automatic integrity gate quarantined for review. Best-effort; never
    // fails or rolls back the recorded run. Practice is ranked:false, so this
    // branch naturally excludes it — practice writes no evidence.
    try {
      await repository.putRefereeEvidence(
        buildEvidenceItem({
          sub: run.owner,
          runId: run.runId,
          mode: run.mode,
          seasonId: season.id,
          runType: "ranked",
          integrityOutcome: automaticReviewReason ?? "accepted",
          reviewSignals: automaticReviewSignals,
          timing: timing.evidence,
          score,
          tiebreaks,
          challenge: run.challenge,
          transcript,
          startedAt: run.startedAt,
          completedAt: result.completedAt,
          wallElapsedMs,
          webVersion: config.webVersion,
          startCorrelation: run.startCorrelation,
          completeCorrelation,
          playerTag: result.profile.playerTag,
        }),
      );
    } catch (error) {
      console.warn("Referee evidence write failed", {
        runId: run.runId,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }

  // Improvement and featured-game XP are exact-once marker transactions. A
  // recorded run must not become a 500 if a follow-up service call is briefly
  // unavailable, so retain the established best-effort completion contract.
  try {
    xpAwards.push(
      ...(await awardRunBonuses(repository, {
        sub: run.owner,
        runId: run.runId,
        mode: run.mode,
        score,
        completedAt: result.completedAt,
        personalBest: personalBest.improved,
        underReview: Boolean(automaticReviewReason),
      })),
    );
  } catch (error) {
    console.warn("Run XP bonus award failed", {
      runId: run.runId,
      error: error instanceof Error ? error.name : "unknown",
    });
  }
  let progressionProfile = result.profile;
  try {
    progressionProfile =
      (await repository.getProfile(run.owner)) ?? result.profile;
  } catch {
    // The transaction already returned the authoritative post-run profile.
  }
  // Badges fold in after the run is recorded, on the same best-effort contract
  // as learning stats: a badge failure must never roll back a recorded game.
  // Practice counts here too — Reps and Clean Sweep are Practice badges.
  const badgeUpdate = await updateBadges(repository, run, transcript, {
    score,
    completedAt: result.completedAt,
    totalGames: result.totalGames,
    xp: progressionProfile.xp ?? 0,
    tzOffsetMinutes: body.tzOffsetMinutes,
    personalBest,
  });
  let earnedBadges = [...badgeUpdate.newlyEarned];
  let finalBadgeStates = badgeUpdate.badges;
  if (badgeUpdate.applied && badgeUpdate.counters) {
    try {
      const badgeXp = await settleBadgeXp(
        repository,
        run.owner,
        badgeUpdate.counters,
        result.completedAt,
        {
          version: badgeUpdate.counters.version,
          updatedAt: result.completedAt,
        },
        { runId: run.runId, completedAt: result.completedAt },
      );
      earnedBadges = [...earnedBadges, ...badgeXp.newlyEarned];
      finalBadgeStates = badgeStates(badgeXp.counters);
      if (badgeXp.awarded > 0)
        xpAwards.push({
          source: "badge",
          label: "Badge milestones",
          amount: badgeXp.awarded,
        });
    } catch (error) {
      console.warn("Badge XP reconciliation failed", {
        runId: run.runId,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
  // The rungs this run cleared, written onto its history row after completion
  // (best-effort, outside the completeRun transaction like the all-time best) so
  // the run sheet can show what moved. Deduped to one entry per badge — a run can
  // clear two rungs of one ladder. A missing history row simply no-ops.
  if (earnedBadges.length) {
    const rungSlugs = [...new Set(earnedBadges.map((rung) => rung.slug))];
    try {
      await repository.setRunRungs(
        run.owner,
        run.runId,
        result.completedAt,
        rungSlugs,
      );
    } catch (error) {
      console.warn("Run rungs write failed", {
        runId: run.runId,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
  let finalProfile = progressionProfile;
  try {
    finalProfile =
      (await repository.getProfile(run.owner)) ?? progressionProfile;
  } catch {
    // Badge/bonus refresh is best-effort; retain the last confirmed profile.
  }
  const crProfile = await completedGameCrProfile(
    repository,
    finalProfile,
    automaticReviewReason,
  );
  console.info(
    automaticReviewReason
      ? "Game completed under referee review"
      : "Game completed",
    {
      runId: run.runId,
      mode: run.mode,
      score,
      seasonId: season.id,
      ...(automaticReviewReason ? { reviewReason: automaticReviewReason } : {}),
    },
  );
  // Practice never reaches the clan feed. It is a private drill — no board, no
  // XP, no record — and an endless session has no comparable number to post:
  // one correct answer then quitting would broadcast "Practice · 100%".
  // Buttondown still receives the authoritative recorded-game total for every
  // mode; only the Discord branch below excludes Practice and reviewed runs.
  await Promise.all([
    updateButtondownSubscriberMetadata(
      {
        apiKey: config.buttondownApiKey,
        newsletterId: config.buttondownNewsletterId,
      },
      finalProfile.email,
      buttondownPlayerMetadata(finalProfile, crProfile),
    ),
    !automaticReviewReason && run.mode !== "practice"
      ? publishDiscordEvent(
          config.discordWebhookUrl,
          completedGameWebhookPayload({
            runId: run.runId,
            mode: run.mode,
            score,
            seasonId: season.id,
            completedAt: result.completedAt,
            profile: finalProfile,
            crProfile,
          }),
        )
      : Promise.resolve(),
    publishTinylyticsEvent({ apiToken: config.tinylyticsApiToken }, event, {
      event: "game.completed",
      value: run.mode,
      path: `/${run.mode}`,
    }),
    personalBest.improved
      ? publishTinylyticsEvent({ apiToken: config.tinylyticsApiToken }, event, {
          event: "game.personal_best",
          value: run.mode,
          path: `/${run.mode}`,
        })
      : Promise.resolve(),
  ]);
  return json(201, {
    accepted: true,
    runId: run.runId,
    mode: run.mode,
    score,
    season,
    ranked: run.ranked !== false,
    completedAt: result.completedAt,
    ...(automaticReviewReason ? { underReview: true } : {}),
    totalGames: result.totalGames,
    xp: finalProfile.xp ?? 0,
    xpEarned: xpAwards.reduce((total, award) => total + award.amount, 0),
    ...(xpAwards.length ? { xpAwards } : {}),
    ...levelForGames(result.totalGames),
    ...(earnedBadges.length ? { earnedBadges } : {}),
    ...(finalBadgeStates ? { badges: { badges: finalBadgeStates } } : {}),
  });
}

// Fold the completed run into the player's badge counters. Best-effort, exactly
// like updateLearningStats below: a badge write that fails leaves the run
// recorded and simply means the rung is picked up on the next completion, since
// counters are derived from history rather than accumulated blindly.
export async function updateBadges(
  repository: Repository,
  run: RunItem,
  transcript: RunTranscript,
  context: {
    score: number;
    completedAt: string;
    totalGames: number;
    xp: number;
    tzOffsetMinutes: unknown;
    personalBest: { improved: boolean; previousScore?: number };
  },
  save: (
    sub: string,
    counters: ReturnType<typeof advanceBadges>["counters"],
    updatedAt: string,
    expected?: { version: number; updatedAt?: string },
  ) => Promise<boolean> = (sub, counters, updatedAt, expected) =>
    repository.saveBadges(sub, counters, updatedAt, expected),
): Promise<{
  newlyEarned: ReturnType<typeof advanceBadges>["newlyEarned"];
  badges?: ReturnType<typeof badgeStates>;
  counters?: ReturnType<typeof advanceBadges>["counters"];
  applied: boolean;
}> {
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const stored = await repository.getBadges(run.owner);
      let counters;
      if (!stored) counters = emptyCounters();
      else if (stored.version === BADGE_COUNTERS_VERSION) counters = stored;
      else if (
        stored.version === 1 ||
        stored.version === 2 ||
        stored.version === 3 ||
        stored.version === 4 ||
        stored.version === 5 ||
        stored.version === 6
      ) {
        // completeRun already wrote this run to history. Migrate from every
        // prior row, then fold the current transcript exactly once below so
        // its forward-only signals can still celebrate normally.
        const priorRuns = (await repository.listAllRuns(run.owner)).filter(
          (
            historical,
          ): historical is typeof historical & { mode: typeof run.mode } =>
            historical.runId !== run.runId && isGameMode(historical.mode),
        );
        counters = migrateBadgeCounters(stored, priorRuns, context.completedAt);
      } else {
        throw new Error(`Unsupported badge counter version ${stored.version}`);
      }
      const { localDay, localHour } = localStamp(
        context.completedAt,
        context.tzOffsetMinutes,
      );
      const answers = Array.isArray(transcript.answers)
        ? transcript.answers.length
        : 0;
      const cardResults = cardResultsFromTranscript(run.challenge, transcript);
      // Photo Finish is a time-mode idea: "beat your best by under 0.1s" has no
      // meaning on a streak or a cleared count, so it is scoped to the two modes
      // whose score IS a duration in milliseconds.
      const isTimed = run.mode === "surge" || run.mode === "trade";
      const improvementMs =
        context.personalBest.previousScore !== undefined
          ? context.personalBest.previousScore - context.score
          : undefined;
      const photoFinish =
        isTimed &&
        context.personalBest.improved &&
        improvementMs !== undefined &&
        improvementMs > 0 &&
        improvementMs < 100;
      // Cold Open: the first run of your local day is a personal best. The stored
      // counters still hold the PREVIOUS run's day, which is what makes "first
      // today" answerable without another read.
      const coldOpen =
        context.personalBest.improved && counters.aux.lastDay !== localDay;
      const { counters: advanced, newlyEarned } = advanceBadges(counters, {
        mode: run.mode,
        boardEpoch: run.boardEpoch,
        score: context.score,
        completedAt: context.completedAt,
        localDay,
        localHour,
        answered: answers,
        correctCards: cardResults
          .filter((result) => result.correct)
          .map((result) => result.cardId),
        totalGames: context.totalGames,
        arena: arenaForXp(context.xp),
        practiceClean:
          run.mode === "practice" &&
          answers >= 20 &&
          cardResults.length === answers &&
          cardResults.every((result) => result.correct),
        ...(photoFinish ? { photoFinish: true } : {}),
        ...(coldOpen ? { coldOpen: true } : {}),
        ...hiddenSignals(run.mode, transcript),
      });
      if (
        await save(
          run.owner,
          advanced,
          context.completedAt,
          stored
            ? { version: stored.version, updatedAt: stored.updatedAt }
            : undefined,
        )
      )
        return {
          newlyEarned,
          badges: badgeStates(advanced),
          counters: advanced,
          applied: true,
        };
    }
    throw new Error("Badge update remained busy after retries");
  } catch (error) {
    console.warn("Badge update failed", {
      runId: run.runId,
      error: error instanceof Error ? error.name : "unknown",
    });
    return { newlyEarned: [], applied: false };
  }
}

// The mode's ordered leaderboard tiebreaks, read off the same validated
// transcript the score came from: Survival ranks equal streaks by fastest
// cumulative time; Higher/Lower ranks equal scores by fewest lives lost, then by
// cumulative time; Rain by fewest wrong guesses, then by lower average clear
// latency. Every other mode ranks on score alone.
function modeTiebreaks(
  run: RunItem,
  transcript: RunTranscript,
  score: number,
): RunTiebreaks | undefined {
  switch (run.mode) {
    case "survival":
      return { timeMs: survivalTimeMs(transcript, score) };
    case "higher-lower":
      return higherLowerTiebreaks(run.challenge, transcript);
    case "rain":
      return rainTiebreaks(run.challenge, transcript);
    default:
      return undefined;
  }
}

// Score the submitted transcript. A scorer rejection is itself referee
// evidence, so it is filed (best-effort) before the 400 goes back.
async function scoreOrFileRejection(
  { event, config, repository }: RouteContext,
  run: RunItem,
  body: Record<string, unknown>,
  season: Season,
  wallElapsedMs: number,
  completeCorrelation: Correlation,
): Promise<{
  score: number;
  transcript: RunTranscript;
  scoringReviewSignals: string[];
}> {
  try {
    const transcript = requireObject(body.transcript ?? {}) as RunTranscript;
    const scored = scoreRunWithSignals(
      run.challenge,
      transcript,
      wallElapsedMs,
    );
    return {
      score: scored.score,
      transcript,
      scoringReviewSignals: scored.reviewSignals,
    };
  } catch (error) {
    // Surface rejected completions in the logs (not just to the player) so we
    // can see when an honest game trips a scorer rule — the run id here
    // matches the one shown to the player.
    const reason = error instanceof Error ? error.message : "scorer_rejected";
    console.warn("Run completion rejected by scorer", {
      requestId: event.requestContext.requestId,
      runId: run.runId,
      mode: run.mode,
      wallElapsedMs,
      reason,
    });
    // Referee evidence for a rejected signed-in run (best-effort; a guest run
    // returned earlier and writes nothing). The scorer may not have produced a
    // score, so store the raw submitted transcript and the reason, no score.
    try {
      await repository.putRefereeEvidence(
        buildEvidenceItem({
          sub: run.owner,
          runId: run.runId,
          mode: run.mode,
          seasonId: season.id,
          runType: "unscored",
          integrityOutcome: reason,
          challenge: run.challenge,
          transcript: (body.transcript ?? {}) as RunTranscript,
          startedAt: run.startedAt,
          completedAt: new Date().toISOString(),
          wallElapsedMs,
          webVersion: config.webVersion,
          startCorrelation: run.startCorrelation,
          completeCorrelation,
        }),
      );
    } catch (evidenceError) {
      console.warn("Referee evidence (scorer reject) write failed", {
        runId: run.runId,
        error: evidenceError instanceof Error ? evidenceError.name : "unknown",
      });
    }
    throw badRequest(error);
  }
}

// Fold the validated transcript into the player's server-side learning stats.
// Best-effort: a stats failure must never fail a recorded game.
async function updateLearningStats(
  repository: Repository,
  run: RunItem,
  transcript: RunTranscript,
  completedAt: string,
) {
  try {
    const cardResults = cardResultsFromTranscript(run.challenge, transcript);
    if (cardResults.length) {
      const existing = await repository.getCardStats(run.owner);
      await repository.saveCardStats(
        run.owner,
        mergeCardStats(existing, cardResults, completedAt),
        completedAt,
      );
    }
  } catch (error) {
    console.warn("Learning stats update failed", {
      runId: run.runId,
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}

// The Discord card shows linked Clash Royale identity — but never for a run
// held for review, which is not announced at all.
async function completedGameCrProfile(
  repository: Repository,
  profile: PlayerProfile,
  automaticReviewReason: string | undefined,
) {
  if (automaticReviewReason || !profile.playerTag) return undefined;
  try {
    return await repository.getCrProfile(profile.playerTag);
  } catch (error) {
    console.warn("Completed game CR profile lookup failed", {
      playerTag: profile.playerTag,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return undefined;
  }
}
