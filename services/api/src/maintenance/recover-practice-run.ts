import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { BADGE_COUNTERS_VERSION, type BadgeCounters } from "../badges.js";
import { hasFirstDropBadge } from "../first-drop.js";
import { assessRunIntegrity } from "../integrity.js";
import {
  Repository,
  type PracticeRecoveryEvidence,
  type RunItem,
} from "../repository.js";
import { updateBadges } from "../routes/runs-complete.js";
import { PRACTICE_MAX_ANSWERS } from "../scoring.js";
import { seasonForDate } from "../seasons.js";
import type { PlayerProfile } from "../types.js";
import { settleBadgeXp } from "../xp-awards.js";

const RECOVERY_REASON = "practice_client_state_lost";
const BROWSER_DELTA_EVIDENCE = "BROWSER#CARD_STATS_MINUS_SERVER";
const ATTESTED_LOWER_BOUND_EVIDENCE =
  "PLAYER_ATTESTATION#PHOTO_CLOCK_LOWER_BOUND";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PracticeRecoveryArgs {
  apply: boolean;
  tableName: string;
  sourceTableName?: string;
  runId: string;
  playerId: string;
  completedAt: string;
  localSeen?: number;
  localCorrect?: number;
  serverSeen?: number;
  serverCorrect?: number;
  attestedAnswers?: number;
  estimatedAccuracy?: number;
}

export interface PracticeRecoveryPlan {
  run: RunItem;
  profile: PlayerProfile;
  completedAt: string;
  seasonId: number;
  score: number;
  evidence: PracticeRecoveryEvidence;
  evidenceSk: string;
  wallElapsedMs: number;
}

function valueAfter(argv: string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value || value.startsWith("--"))
    throw new Error(`${name} requires a value`);
  return value;
}

function countAfter(argv: string[], name: string): number {
  const raw = valueAfter(argv, name);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function isoAfter(argv: string[], name: string): string {
  const value = valueAfter(argv, name);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be an ISO date`);
  return new Date(parsed).toISOString();
}

export function parsePracticeRecoveryArgs(
  argv: string[],
): PracticeRecoveryArgs {
  const flagsWithValues = new Set([
    "--table",
    "--source-table",
    "--player-id",
    "--completed-at",
    "--local-seen",
    "--local-correct",
    "--server-seen",
    "--server-correct",
    "--attested-answers",
    "--estimated-accuracy",
  ]);
  const consumed = new Set<number>();
  for (let index = 0; index < argv.length; index += 1) {
    if (!flagsWithValues.has(argv[index] ?? "")) continue;
    consumed.add(index);
    consumed.add(index + 1);
  }
  const positional = argv.filter(
    (argument, index) => argument !== "--apply" && !consumed.has(index),
  );
  if (positional.length !== 1 || !UUID.test(positional[0] ?? ""))
    throw new Error("Pass exactly one retained Practice run UUID");

  const playerId = valueAfter(argv, "--player-id");
  if (!UUID.test(playerId)) throw new Error("--player-id must be a UUID");
  const tableIndex = argv.indexOf("--table");
  const tableName =
    tableIndex >= 0
      ? valueAfter(argv, "--table")
      : process.env.DROP_TABLE_NAME || process.env.TABLE_NAME || "elixir-drop";
  const sourceTableName = argv.includes("--source-table")
    ? valueAfter(argv, "--source-table")
    : undefined;
  if (
    sourceTableName &&
    (!sourceTableName.startsWith("elixir-drop-recovery-") ||
      sourceTableName === tableName)
  )
    throw new Error(
      "--source-table must name a separate elixir-drop-recovery-* table",
    );

  const browserFlags = [
    "--local-seen",
    "--local-correct",
    "--server-seen",
    "--server-correct",
  ];
  const browserFlagCount = browserFlags.filter((flag) =>
    argv.includes(flag),
  ).length;
  const hasAttestedAnswers = argv.includes("--attested-answers");
  const hasEstimatedAccuracy = argv.includes("--estimated-accuracy");
  if (browserFlagCount && (hasAttestedAnswers || hasEstimatedAccuracy))
    throw new Error(
      "Use either browser-delta evidence or attested lower-bound evidence",
    );
  if (browserFlagCount !== 0 && browserFlagCount !== browserFlags.length)
    throw new Error("Browser-delta recovery requires all four counter flags");
  if (hasAttestedAnswers !== hasEstimatedAccuracy)
    throw new Error(
      "Attested recovery requires --attested-answers and --estimated-accuracy",
    );
  if (browserFlagCount === 0 && !hasAttestedAnswers)
    throw new Error(
      "Pass browser-delta counters or an attested answer lower bound",
    );

  const estimatedAccuracy = hasEstimatedAccuracy
    ? countAfter(argv, "--estimated-accuracy")
    : undefined;
  if (estimatedAccuracy !== undefined && estimatedAccuracy > 100)
    throw new Error("--estimated-accuracy must be between 0 and 100");

  return {
    apply: argv.includes("--apply"),
    tableName,
    ...(sourceTableName ? { sourceTableName } : {}),
    runId: positional[0]!,
    playerId,
    completedAt: isoAfter(argv, "--completed-at"),
    ...(browserFlagCount
      ? {
          localSeen: countAfter(argv, "--local-seen"),
          localCorrect: countAfter(argv, "--local-correct"),
          serverSeen: countAfter(argv, "--server-seen"),
          serverCorrect: countAfter(argv, "--server-correct"),
        }
      : {
          attestedAnswers: countAfter(argv, "--attested-answers"),
          estimatedAccuracy,
        }),
  };
}

export function planPracticeRecovery(
  run: RunItem,
  profile: PlayerProfile,
  input: Omit<PracticeRecoveryArgs, "apply" | "tableName" | "runId">,
  seasonId: number,
): PracticeRecoveryPlan {
  if (run.mode !== "practice" || run.challenge.mode !== "practice")
    throw new Error("The retained run is not Practice");
  if (run.owner === "guest" || run.guest === true || run.ranked !== false)
    throw new Error(
      "The retained run is not a signed-in unranked Practice run",
    );
  if (profile.sub !== run.owner || profile.playerId !== input.playerId)
    throw new Error("The expected player does not own the retained run");
  const isAttested = input.attestedAnswers !== undefined;
  let answerCount: number;
  let correctCount: number;
  let score: number;
  let evidence: PracticeRecoveryEvidence;
  let evidenceSk: string;
  if (isAttested) {
    if (
      input.estimatedAccuracy === undefined ||
      !Number.isSafeInteger(input.estimatedAccuracy) ||
      input.estimatedAccuracy < 0 ||
      input.estimatedAccuracy > 100
    )
      throw new Error("Attested recovery has invalid estimated accuracy");
    answerCount = input.attestedAnswers!;
    score = input.estimatedAccuracy;
    correctCount = Math.round((answerCount * score) / 100);
    evidenceSk = ATTESTED_LOWER_BOUND_EVIDENCE;
    evidence = {
      playerId: input.playerId,
      method: "attested_lower_bound",
      estimatedAccuracy: score,
      answerCount,
      correctCount,
    };
  } else {
    const { localSeen, localCorrect, serverSeen, serverCorrect } = input;
    if (
      localSeen === undefined ||
      localCorrect === undefined ||
      serverSeen === undefined ||
      serverCorrect === undefined
    )
      throw new Error("Browser-delta recovery is missing counter evidence");
    if (localCorrect > localSeen)
      throw new Error("Local correct count exceeds local seen count");
    if (serverCorrect > serverSeen)
      throw new Error("Server correct count exceeds server seen count");
    answerCount = localSeen - serverSeen;
    correctCount = localCorrect - serverCorrect;
    score = Math.round((correctCount / answerCount) * 100);
    evidenceSk = BROWSER_DELTA_EVIDENCE;
    evidence = {
      playerId: input.playerId,
      localSeen,
      localCorrect,
      serverSeen,
      serverCorrect,
      answerCount,
      correctCount,
    };
  }
  if (answerCount < 1 || answerCount > PRACTICE_MAX_ANSWERS)
    throw new Error("Recovery answer count is outside Practice limits");
  if (correctCount < 0 || correctCount > answerCount)
    throw new Error("Recovery correct count is inconsistent");

  const completedAtMs = Date.parse(input.completedAt);
  const startedAtMs = Date.parse(run.startedAt);
  if (
    !Number.isFinite(startedAtMs) ||
    completedAtMs <= startedAtMs ||
    completedAtMs > Date.now()
  )
    throw new Error("Recovery completion time is outside the retained run");
  const wallElapsedMs = completedAtMs - startedAtMs;
  const integrity = assessRunIntegrity(
    "practice",
    score,
    wallElapsedMs,
    answerCount,
  );
  if (!integrity.eligible)
    throw new Error(
      `Aggregate Practice evidence fails integrity: ${integrity.reason}`,
    );

  return {
    run: { ...run, answerCount },
    profile,
    completedAt: input.completedAt,
    seasonId,
    score,
    evidence,
    evidenceSk,
    wallElapsedMs,
  };
}

function sameEvidence(
  left: PracticeRecoveryEvidence | undefined,
  right: PracticeRecoveryEvidence,
): boolean {
  return (
    left !== undefined &&
    Object.entries(right).every(
      ([key, value]) => left[key as keyof PracticeRecoveryEvidence] === value,
    )
  );
}

export function recoveredRungSlugs(
  counters: BadgeCounters,
  completedAt: string,
): string[] {
  return Object.entries(counters.earned)
    .filter(([, timestamps]) => timestamps.includes(completedAt))
    .map(([slug]) => slug);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parsePracticeRecoveryArgs(argv);
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region) throw new Error("Set AWS_REGION before running the recovery");

  const identity = await new STSClient({ region }).send(
    new GetCallerIdentityCommand({}),
  );
  const cloudEngineer = (identity.Arn ?? "").includes(
    ":assumed-role/ProjectsCloudEngineer/",
  );
  if (!cloudEngineer)
    throw new Error("Practice recovery requires ProjectsCloudEngineer");

  const repository = new Repository(args.tableName);
  const retainedRun = await repository.getRun(args.runId);
  const sourceRun =
    !retainedRun && args.sourceTableName
      ? await new Repository(args.sourceTableName).getRun(args.runId)
      : undefined;
  const run = retainedRun ?? sourceRun;
  if (!run) throw new Error("The retained Practice run was not found");
  const createRun = !retainedRun && sourceRun !== undefined;
  if (createRun && run.state !== "started")
    throw new Error("The source Practice run is not in started state");
  const profile = await repository.getProfile(run.owner);
  if (!profile)
    throw new Error("The retained Practice run has no player profile");
  const clock = await repository.getCrWarClock();
  const season = seasonForDate(new Date(args.completedAt), clock);
  const plan = planPracticeRecovery(run, profile, args, season.id);
  let marker = await repository.getRunRecovery(run.runId);

  if (retainedRun?.state === "completed" && !marker) {
    if (
      run.score !== plan.score ||
      run.answerCount !== plan.evidence.answerCount
    )
      throw new Error(
        "The completed Practice run conflicts with this recovery",
      );
    process.stdout.write(
      `${JSON.stringify({ status: "already_recorded", runId: run.runId }, null, 2)}\n`,
    );
    return;
  }
  if (retainedRun?.state === "started" && marker)
    throw new Error("A recovery marker exists for a started Practice run");
  if (
    marker &&
    (marker.mode !== "practice" ||
      marker.score !== plan.score ||
      marker.seasonId !== plan.seasonId ||
      marker.evidenceSk !== plan.evidenceSk ||
      !sameEvidence(marker.practiceEvidence, plan.evidence))
  )
    throw new Error("The existing Practice recovery does not match this plan");

  const preview = {
    runId: run.runId,
    playerId: profile.playerId,
    publicName: profile.publicName,
    completedAt: plan.completedAt,
    seasonId: plan.seasonId,
    answerCount: plan.evidence.answerCount,
    correctCount: plan.evidence.correctCount,
    score: plan.score,
    wallElapsedMs: plan.wallElapsedMs,
    xpBasis: { practiceCards: plan.evidence.answerCount },
    learningDetail: "not_reconstructed",
    evidence: plan.evidenceSk,
    reconstructExpiredRun: createRun,
  };
  if (!args.apply) {
    process.stdout.write(
      `${JSON.stringify(
        {
          status: marker?.recoveryCompletedAt
            ? "already_recovered"
            : marker
              ? "recovery_incomplete"
              : "ready",
          table: args.tableName,
          recovery: preview,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const recoveredAt = new Date().toISOString();
  let finalProfile = profile;
  if (!marker) {
    const completed = await repository.completeRun(
      plan.run,
      plan.score,
      plan.seasonId,
      { practiceCards: plan.evidence.answerCount },
      undefined,
      undefined,
      {
        completedAt: plan.completedAt,
        recoveredAt,
        evidenceSk: plan.evidenceSk,
        reason: RECOVERY_REASON,
        practiceEvidence: plan.evidence,
        ...(createRun ? { createRun: true } : {}),
      },
    );
    finalProfile = completed.profile;
    marker = await repository.getRunRecovery(run.runId);
  } else {
    finalProfile = (await repository.getProfile(run.owner)) ?? profile;
  }
  if (!marker) throw new Error("Practice recovery marker could not be loaded");

  if (!marker.badgesAppliedAt) {
    const badgeUpdate = await updateBadges(
      repository,
      plan.run,
      { answers: [] },
      {
        score: plan.score,
        completedAt: plan.completedAt,
        totalGames: finalProfile.totalGames,
        xp: finalProfile.xp ?? 0,
        playerTag: finalProfile.playerTag,
        heraldOpens: finalProfile.heraldOpens,
        recruiterCount: finalProfile.recruiterCount,
        firstDrop: hasFirstDropBadge(finalProfile),
        tzOffsetMinutes: undefined,
        personalBest: { improved: false },
        aggregatePractice: {
          answered: plan.evidence.answerCount,
          correct: plan.evidence.correctCount,
        },
      },
      (sub, counters, _completedAt, expected) =>
        repository.saveRecoveredBadges(
          sub,
          plan.run.runId,
          counters,
          recoveredAt,
          expected,
        ),
    );
    if (!badgeUpdate.applied)
      throw new Error("Practice badge recovery did not apply");
  }
  const recoveredBadges = await repository.getBadges(run.owner);
  if (!recoveredBadges || recoveredBadges.version !== BADGE_COUNTERS_VERSION)
    throw new Error("Recovered Practice badges could not be loaded");
  const badgeXp = await settleBadgeXp(
    repository,
    run.owner,
    recoveredBadges,
    marker.recoveredAt,
    {
      version: recoveredBadges.version,
      updatedAt: recoveredBadges.updatedAt,
    },
    { runId: run.runId, completedAt: plan.completedAt },
  );
  const rungSlugs = [
    ...new Set([
      ...recoveredRungSlugs(recoveredBadges, plan.completedAt),
      ...badgeXp.newlyEarned.map((rung) => rung.slug),
    ]),
  ];
  await repository.setRunRungs(
    run.owner,
    run.runId,
    plan.completedAt,
    rungSlugs,
  );
  await repository.finishRunRecovery(run.runId, recoveredAt);
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "recovered",
        table: args.tableName,
        recovery: {
          ...preview,
          badgeXpAwarded: badgeXp.awarded,
          rungSlugs,
        },
      },
      null,
      2,
    )}\n`,
  );
}

if (typeof require !== "undefined" && require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Practice recovery failed"}\n`,
    );
    process.exitCode = 1;
  });
}
