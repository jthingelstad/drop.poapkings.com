import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  completedGameWebhookPayload,
  publishDiscordEvent,
} from "../discord.js";
import { badRequest, HttpError } from "../errors.js";
import { json } from "../http.js";
import { assessRunIntegrity } from "../integrity.js";
import { cardResultsFromTranscript, mergeCardStats } from "../learning.js";
import { levelForGames } from "../progression.js";
import { buildEvidenceItem, deriveCorrelation } from "../referee-evidence.js";
import type { Repository, RunItem } from "../repository.js";
import {
  higherLowerTiebreaks,
  scoreRun,
  scoreRunWithSignals,
  survivalTimeMs,
} from "../scoring.js";
import { seasonForDate } from "../seasons.js";
import { verifyToken } from "../signing.js";
import type { Correlation, PlayerProfile, RunTranscript } from "../types.js";
import { requireObject } from "../validation.js";
import { runXp } from "../xp.js";
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

  const integrity = assessRunIntegrity(
    run.mode,
    score,
    wallElapsedMs,
    Array.isArray(transcript.answers) ? transcript.answers.length : undefined,
  );
  const automaticReviewSignals = [
    ...scoringReviewSignals,
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
  // Practice earns NO Player XP. It is an endless, non-competitive drill, so
  // paying one XP per question would let a player farm the 28-tier arena just by
  // never ending the session. The run itself is still completed and recorded —
  // that is what feeds the server-owned learning stats below — it simply moves
  // no progression. The exclusion is stated here, at the call site, rather than
  // buried as a mode branch inside runXp.
  const xpAward = run.mode === "practice" ? 0 : runXp(transcript);
  // Survival ranks equal streaks by fastest cumulative time; Higher/Lower ranks
  // equal scores by fewest lives lost, and only then by cumulative time.
  const tiebreaks =
    run.mode === "survival"
      ? { timeMs: survivalTimeMs(transcript, score) }
      : higherLowerTiebreaks(run.challenge, transcript);
  const result = await repository.completeRun(
    run,
    score,
    season.id,
    xpAward,
    tiebreaks,
    automaticReviewReason,
  );
  await updateLearningStats(repository, run, transcript, result.completedAt);
  // Best-effort all-time best per mode, outside the completeRun transaction so
  // a "not a new best" no-op can never roll back the recorded run. Ranked
  // only; Practice keeps no board.
  if (run.ranked !== false) {
    try {
      await repository.updateAllTimeBest(
        run,
        score,
        tiebreaks,
        result.completedAt,
      );
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
  const crProfile = await completedGameCrProfile(
    repository,
    result.profile,
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
  if (!automaticReviewReason && run.mode !== "practice") {
    await publishDiscordEvent(
      config.discordWebhookUrl,
      completedGameWebhookPayload({
        runId: run.runId,
        mode: run.mode,
        score,
        seasonId: season.id,
        completedAt: result.completedAt,
        profile: result.profile,
        crProfile,
      }),
    );
  }
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
    xp: result.profile.xp ?? 0,
    ...levelForGames(result.totalGames),
  });
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
