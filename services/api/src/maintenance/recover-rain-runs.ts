import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { boardEpochFor } from "../games.js";
import { assessRunIntegrity } from "../integrity.js";
import { Repository, type RunItem } from "../repository.js";
import { updateBadges } from "../routes/runs-complete.js";
import { cardElixir, rainTiebreaks, scoreRunWithSignals } from "../scoring.js";
import type { EvidenceItem, RunTiebreaks, RunTranscript } from "../types.js";
import { runXp } from "../xp.js";

const RECOVERY_REASON = "rain_final_life_input_race";
const MAX_RECOVERIES = 10;
const MAX_TERMINAL_WINDOW_MS = 200;

interface RecoverySpec {
  runId: string;
  expectedScore: number;
}

export interface RainRecoveryPlan {
  run: RunItem;
  evidence: EvidenceItem;
  transcript: RunTranscript;
  score: number;
  xp: number;
  answerCount: number;
  tiebreaks: RunTiebreaks;
  ignoredAnswerCount: number;
  terminalInputDelayMs: number;
}

function objectAnswers(
  transcript: RunTranscript,
): Array<Record<string, unknown>> {
  if (!Array.isArray(transcript.answers))
    throw new Error("Rain recovery evidence has no answer transcript");
  return transcript.answers.filter(
    (answer): answer is Record<string, unknown> =>
      Boolean(answer) && typeof answer === "object" && !Array.isArray(answer),
  );
}

function cleared(answer: Record<string, unknown>): boolean {
  const expected = cardElixir(Number(answer.cardId));
  return (
    expected !== undefined &&
    answer.guess !== null &&
    answer.guess !== undefined &&
    Number(answer.guess) === expected
  );
}

function sameRainChallenge(left: unknown, right: unknown): boolean {
  const a = left as { mode?: unknown; cardIds?: unknown };
  const b = right as { mode?: unknown; cardIds?: unknown };
  const aCardIds = Array.isArray(a?.cardIds) ? a.cardIds : undefined;
  const bCardIds = Array.isArray(b?.cardIds) ? b.cardIds : undefined;
  return (
    a?.mode === "rain" &&
    b?.mode === "rain" &&
    aCardIds !== undefined &&
    bCardIds !== undefined &&
    aCardIds.length === bCardIds.length &&
    aCardIds.every((cardId, index) => cardId === bCardIds[index])
  );
}

// Turn the retained rejected transcript into the exact transcript the browser
// should have submitted: stop at the third spent life. Every guard describes
// the known client race, so this refuses to repair a merely similar rejection.
export function planRainRecovery(
  evidence: EvidenceItem,
  run: RunItem,
  expectedScore: number,
): RainRecoveryPlan {
  if (
    evidence.runId !== run.runId ||
    evidence.playerSub !== run.owner ||
    evidence.mode !== "rain" ||
    run.mode !== "rain"
  )
    throw new Error("Recovery evidence does not own the Rain run");
  if (
    evidence.runType !== "unscored" ||
    evidence.integrityOutcome !== "Rain continued past three lives"
  )
    throw new Error("Recovery evidence is not the final-life Rain rejection");
  if (!sameRainChallenge(evidence.challenge, run.challenge))
    throw new Error("Recovery evidence does not match the signed challenge");

  const answers = objectAnswers(evidence.transcript);
  let misses = 0;
  let terminalIndex = -1;
  for (let index = 0; index < answers.length; index += 1) {
    const answer = answers[index];
    if (!answer || cleared(answer)) continue;
    misses += 1;
    if (misses === 3) {
      terminalIndex = index;
      break;
    }
  }
  if (terminalIndex < 0)
    throw new Error("Recovery transcript never spends the third Rain life");

  const ignored = answers.slice(terminalIndex + 1);
  if (ignored.length !== 1 || !ignored[0] || !cleared(ignored[0]))
    throw new Error("Recovery transcript is not the one-answer terminal race");
  const terminalAt = Number(answers[terminalIndex]?.atMs);
  const ignoredAt = Number(ignored[0].atMs);
  const terminalInputDelayMs = ignoredAt - terminalAt;
  if (
    !Number.isFinite(terminalInputDelayMs) ||
    terminalInputDelayMs < 0 ||
    terminalInputDelayMs > MAX_TERMINAL_WINDOW_MS
  )
    throw new Error("Recovery answer is outside the Rain terminal frame");

  const canonicalAnswers = answers.slice(0, terminalIndex + 1);
  const transcript: RunTranscript = {
    ...evidence.transcript,
    answers: canonicalAnswers,
  };
  const scored = scoreRunWithSignals(
    run.challenge,
    transcript,
    evidence.wallElapsedMs,
  );
  if (scored.reviewSignals.length)
    throw new Error(
      `Canonical Rain run still needs review: ${scored.reviewSignals.join(",")}`,
    );
  if (scored.score !== expectedScore)
    throw new Error(
      `Canonical Rain score ${scored.score} does not match expected ${expectedScore}`,
    );
  const integrity = assessRunIntegrity(
    "rain",
    scored.score,
    evidence.wallElapsedMs,
    canonicalAnswers.length,
  );
  if (!integrity.eligible)
    throw new Error(`Canonical Rain run fails integrity: ${integrity.reason}`);
  const tiebreaks = rainTiebreaks(run.challenge, transcript);
  if (!tiebreaks)
    throw new Error("Canonical Rain tiebreaks could not be derived");

  return {
    run: { ...run, answerCount: canonicalAnswers.length },
    evidence,
    transcript,
    score: scored.score,
    xp: runXp("rain", scored.score),
    answerCount: canonicalAnswers.length,
    tiebreaks,
    ignoredAnswerCount: ignored.length,
    terminalInputDelayMs,
  };
}

export function parseRecoveryArgs(argv: string[]): {
  apply: boolean;
  tableName: string;
  specs: RecoverySpec[];
} {
  const apply = argv.includes("--apply");
  const tableIndex = argv.indexOf("--table");
  const tableName =
    tableIndex >= 0
      ? argv[tableIndex + 1]
      : process.env.DROP_TABLE_NAME || process.env.TABLE_NAME || "elixir-drop";
  if (!tableName || tableName.startsWith("--"))
    throw new Error("--table requires a table name");
  const positional = argv.filter(
    (argument, index) =>
      argument !== "--apply" &&
      argument !== "--table" &&
      (tableIndex < 0 || index !== tableIndex + 1),
  );
  if (!positional.length || positional.length > MAX_RECOVERIES)
    throw new Error(
      `Pass 1-${MAX_RECOVERIES} recovery specs as <run-uuid>=<expected-score>`,
    );
  const seen = new Set<string>();
  const specs = positional.map((argument) => {
    const [runId, rawScore, extra] = argument.split("=");
    const expectedScore = Number(rawScore);
    if (
      extra !== undefined ||
      !runId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        runId,
      ) ||
      !Number.isSafeInteger(expectedScore) ||
      expectedScore < 0
    )
      throw new Error(`Invalid recovery spec: ${argument}`);
    if (seen.has(runId)) throw new Error(`Duplicate recovery run: ${runId}`);
    seen.add(runId);
    return { runId, expectedScore };
  });
  return { apply, tableName, specs };
}

async function findEvidence(
  documentClient: DynamoDBDocumentClient,
  tableName: string,
  specs: RecoverySpec[],
): Promise<Map<string, EvidenceItem>> {
  const values = Object.fromEntries(
    specs.map((spec, index) => [`:run${index}`, spec.runId]),
  );
  const matches = new Map<string, EvidenceItem[]>();
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await documentClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: `runId IN (${Object.keys(values).join(", ")})`,
        ExpressionAttributeValues: values,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const item of page.Items ?? []) {
      if (
        item.sk?.startsWith?.("EVIDENCE#") &&
        typeof item.runId === "string"
      ) {
        const bucket = matches.get(item.runId) ?? [];
        bucket.push(item as EvidenceItem);
        matches.set(item.runId, bucket);
      }
    }
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);

  const evidence = new Map<string, EvidenceItem>();
  for (const spec of specs) {
    const candidates = matches.get(spec.runId) ?? [];
    if (candidates.length !== 1)
      throw new Error(
        `Expected one retained evidence item for ${spec.runId}, found ${candidates.length}`,
      );
    evidence.set(spec.runId, candidates[0]!);
  }
  return evidence;
}

async function main(): Promise<void> {
  const { apply, tableName, specs } = parseRecoveryArgs(process.argv.slice(2));
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region) throw new Error("Set AWS_REGION before running the recovery");

  const identity = await new STSClient({ region }).send(
    new GetCallerIdentityCommand({}),
  );
  const callerArn = identity.Arn ?? "";
  const cloudEngineer = callerArn.includes(
    ":assumed-role/ProjectsCloudEngineer/",
  );
  const refereeRead = callerArn.includes(
    ":assumed-role/elixir-drop-referee-read/",
  );
  if (apply && !cloudEngineer)
    throw new Error("Apply requires the ProjectsCloudEngineer assumed role");
  if (!apply && !cloudEngineer && !refereeRead)
    throw new Error(
      "Dry-run requires ProjectsCloudEngineer or elixir-drop-referee-read",
    );

  const documentClient = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region }),
    { marshallOptions: { removeUndefinedValues: true } },
  );
  const repository = new Repository(tableName);
  const evidence = await findEvidence(documentClient, tableName, specs);
  const plans: RainRecoveryPlan[] = [];
  const expiredRunIds = new Set<string>();
  for (const spec of specs) {
    const retainedEvidence = evidence.get(spec.runId)!;
    const retainedRun = await repository.getRun(spec.runId);
    const run: RunItem =
      retainedRun ??
      (() => {
        expiredRunIds.add(spec.runId);
        return {
          pk: `RUN#${spec.runId}`,
          sk: "RUN",
          runId: spec.runId,
          owner: retainedEvidence.playerSub,
          mode: "rain",
          challenge: retainedEvidence.challenge,
          state: "started",
          startedAt: retainedEvidence.startedAt,
          // Reconstructed only for replay parity; durable history has no TTL.
          // Keep this ephemeral row for at most one day instead of inheriting
          // the evidence record's much longer retention window.
          expiresAt: Math.min(
            retainedEvidence.expiresAt,
            Math.floor(Date.now() / 1_000) + 24 * 60 * 60,
          ),
          boardEpoch: boardEpochFor("rain"),
          startCorrelation: retainedEvidence.correlation.start,
        };
      })();
    plans.push(planRainRecovery(retainedEvidence, run, spec.expectedScore));
  }
  plans.sort((left, right) =>
    left.evidence.completedAt.localeCompare(right.evidence.completedAt),
  );

  const results: Array<Record<string, unknown>> = [];
  for (const plan of plans) {
    let marker = await repository.getRunRecovery(plan.run.runId);
    if (plan.run.state === "completed" && !marker) {
      if (
        plan.run.score !== plan.score ||
        plan.run.seasonId !== plan.evidence.seasonId
      )
        throw new Error(
          `Completed run conflicts with recovery plan: ${plan.run.runId}`,
        );
      results.push({
        runId: plan.run.runId,
        status: "already_recorded",
        score: plan.score,
      });
      continue;
    }
    if (plan.run.state === "started" && marker)
      throw new Error(
        `Recovery marker exists for a started run: ${plan.run.runId}`,
      );
    if (
      marker &&
      (marker.score !== plan.score ||
        marker.seasonId !== plan.evidence.seasonId ||
        marker.evidenceSk !== plan.evidence.sk)
    )
      throw new Error(`Recovery marker does not match plan: ${plan.run.runId}`);

    const preview = {
      runId: plan.run.runId,
      score: plan.score,
      xp: plan.xp,
      answerCount: plan.answerCount,
      ignoredAnswerCount: plan.ignoredAnswerCount,
      terminalInputDelayMs: plan.terminalInputDelayMs,
      seasonId: plan.evidence.seasonId,
      completedAt: plan.evidence.completedAt,
      tiebreaks: plan.tiebreaks,
      sourceRun: expiredRunIds.has(plan.run.runId) ? "expired" : "retained",
    };
    if (!apply) {
      results.push({
        ...preview,
        status: marker?.recoveryCompletedAt
          ? "already_recovered"
          : marker
            ? "recovery_incomplete"
            : "ready",
      });
      continue;
    }

    const recoveredAt = new Date().toISOString();
    let profile;
    if (!marker) {
      const completed = await repository.completeRun(
        plan.run,
        plan.score,
        plan.evidence.seasonId,
        plan.xp,
        plan.tiebreaks,
        undefined,
        {
          completedAt: plan.evidence.completedAt,
          recoveredAt,
          evidenceSk: plan.evidence.sk,
          reason: RECOVERY_REASON,
          createRun: expiredRunIds.has(plan.run.runId),
        },
      );
      profile = completed.profile;
      marker = await repository.getRunRecovery(plan.run.runId);
    } else {
      profile = await repository.getProfile(plan.run.owner);
    }
    if (!profile || !marker)
      throw new Error(`Recovery state could not be loaded: ${plan.run.runId}`);

    await repository.updateAllTimeBest(
      plan.run,
      plan.score,
      plan.tiebreaks,
      plan.evidence.completedAt,
    );
    if (!marker.badgesAppliedAt) {
      const badgeUpdate = await updateBadges(
        repository,
        plan.run,
        plan.transcript,
        {
          score: plan.score,
          completedAt: plan.evidence.completedAt,
          totalGames: profile.totalGames,
          xp: profile.xp ?? 0,
          // Rejected evidence predates storage of the player's offset. UTC is
          // the badge engine's documented historical-backfill approximation.
          tzOffsetMinutes: undefined,
          // Rain is not a timed Photo Finish mode. Avoid inventing a historical
          // Cold Open from a personal-best state that no longer exists.
          personalBest: { improved: false },
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
        throw new Error(`Badge recovery failed: ${plan.run.runId}`);
    }
    await repository.finishRunRecovery(plan.run.runId, recoveredAt);
    results.push({ ...preview, status: "recovered" });
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        status: apply ? "applied" : "dry_run",
        table: tableName,
        callerRole: cloudEngineer ? "cloud-engineer" : "referee-read",
        runs: results,
      },
      null,
      2,
    )}\n`,
  );
}

if (typeof require !== "undefined" && require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Rain recovery failed"}\n`,
    );
    process.exitCode = 1;
  });
}
