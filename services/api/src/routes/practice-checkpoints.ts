import rawCards from "@elixir-drop/game-data/cards.json";
import { badRequest, HttpError } from "../errors.js";
import { json } from "../http.js";
import type {
  PracticeCheckpointAnswer,
  PracticeCheckpointReview,
  RunItem,
} from "../repository.js";
import { signToken, verifyToken } from "../signing.js";
import { requireObject } from "../validation.js";
import { bodyOf, sessionFor, type RouteContext } from "./context.js";
import { RUN_TOKEN_GRACE_SECONDS } from "./runs-start.js";

const CHECKPOINT_SIZE = 20;
const MAX_ANSWERS = 10_000;
const MAX_REVIEW_QUEUE = 250;
const cards = new Map(
  (
    rawCards as {
      cards: Array<{ id: number; elixir: number }>;
    }
  ).cards.map((card) => [card.id, card]),
);

function reviewStage(value: unknown): value is "retry" | "confirm" {
  return value === "retry" || value === "confirm";
}

function checkpointAnswers(
  value: unknown,
  run: RunItem,
): PracticeCheckpointAnswer[] {
  if (!Array.isArray(value) || value.length !== CHECKPOINT_SIZE)
    throw new Error(`A Practice checkpoint needs ${CHECKPOINT_SIZE} answers`);
  if (run.challenge.mode !== "practice")
    throw new Error("Practice checkpoint challenge is invalid");
  const deck = new Set(run.challenge.cardIds);
  return value.map((candidate) => {
    const answer = requireObject(candidate, "Practice checkpoint answer");
    const cardId = Number(answer.cardId);
    const guess = Number(answer.guess);
    const responseMs = Number(answer.responseMs);
    const assisted = answer.assisted;
    const card = cards.get(cardId);
    if (!card || !deck.has(cardId))
      throw new Error("Practice checkpoint card is not from the signed deck");
    if (!Number.isSafeInteger(guess))
      throw new Error("Practice checkpoint answer is invalid");
    if (
      !Number.isSafeInteger(responseMs) ||
      responseMs < 0 ||
      responseMs > 60_000
    )
      throw new Error("Practice checkpoint response time is invalid");
    if (typeof assisted !== "boolean")
      throw new Error("Practice checkpoint assistance is invalid");
    if (answer.reviewStage !== undefined && !reviewStage(answer.reviewStage))
      throw new Error("Practice checkpoint review stage is invalid");
    return {
      cardId,
      guess,
      responseMs,
      assisted,
      correct: guess === card.elixir,
      ...(reviewStage(answer.reviewStage)
        ? { reviewStage: answer.reviewStage }
        : {}),
    };
  });
}

function checkpointReviews(
  value: unknown,
  run: RunItem,
): PracticeCheckpointReview[] {
  if (!Array.isArray(value) || value.length > MAX_REVIEW_QUEUE)
    throw new Error("Practice checkpoint review queue is invalid");
  if (run.challenge.mode !== "practice")
    throw new Error("Practice checkpoint challenge is invalid");
  const deck = new Set(run.challenge.cardIds);
  return value.map((candidate) => {
    const review = requireObject(candidate, "Practice checkpoint review");
    const cardId = Number(review.cardId);
    const dueAtAnswered = Number(review.dueAtAnswered);
    if (
      !deck.has(cardId) ||
      !Number.isSafeInteger(dueAtAnswered) ||
      dueAtAnswered < 0 ||
      dueAtAnswered > MAX_ANSWERS ||
      !reviewStage(review.stage)
    )
      throw new Error("Practice checkpoint review is invalid");
    return { cardId, dueAtAnswered, stage: review.stage };
  });
}

function activePracticeRun(
  run: RunItem | undefined,
  sub: string,
  nowSeconds: number,
): run is RunItem & { challenge: { mode: "practice"; cardIds: number[] } } {
  return Boolean(
    run &&
    run.owner === sub &&
    run.mode === "practice" &&
    run.challenge.mode === "practice" &&
    run.guest !== true &&
    run.state === "started" &&
    run.expiresAt > nowSeconds,
  );
}

export async function savePracticeCheckpoint({
  event,
  config,
  repository,
}: RouteContext) {
  const session = sessionFor(event, config.sessionSecret, true);
  await repository.useRateLimit(
    "practice-checkpoint",
    session.sub,
    600,
    60 * 60,
  );
  const body = bodyOf(event);
  if (typeof body.runToken !== "string")
    throw new HttpError(400, "A signed Practice run token is required.");
  let claims;
  try {
    claims = verifyToken(body.runToken, "run", config.sessionSecret);
  } catch {
    throw new HttpError(
      401,
      "This Practice run token is invalid or expired.",
      "invalid_run_token",
    );
  }
  if (
    claims.owner !== session.sub ||
    claims.mode !== "practice" ||
    claims.guest === true
  )
    throw new HttpError(
      403,
      "This Practice run belongs to another player.",
      "run_owner_mismatch",
    );
  const run = await repository.getRun(claims.runId);
  const nowSeconds = Math.floor(Date.now() / 1_000);
  if (!run || run.owner !== claims.owner || run.mode !== claims.mode)
    throw new HttpError(
      409,
      "This Practice run is no longer valid.",
      "run_conflict",
    );
  if (run.state !== "started")
    throw new HttpError(
      409,
      "This Practice run was already recorded.",
      "run_conflict",
    );
  if (run.expiresAt <= nowSeconds)
    throw new HttpError(
      410,
      "This Practice run expired before the checkpoint arrived.",
      "run_expired",
    );

  let checkpoint: {
    startIndex: number;
    answers: PracticeCheckpointAnswer[];
    reviewQueue: PracticeCheckpointReview[];
    recovered: number;
  };
  try {
    const startIndex = Number(body.startIndex);
    if (
      !Number.isSafeInteger(startIndex) ||
      startIndex < 0 ||
      startIndex > MAX_ANSWERS - CHECKPOINT_SIZE ||
      startIndex % CHECKPOINT_SIZE !== 0
    )
      throw new Error("Practice checkpoint position is invalid");
    const answers = checkpointAnswers(body.answers, run);
    const reviewQueue = checkpointReviews(body.reviewQueue, run);
    const recovered = Number(body.recovered);
    if (
      !Number.isSafeInteger(recovered) ||
      recovered < 0 ||
      recovered > startIndex + answers.length
    )
      throw new Error("Practice checkpoint recovery count is invalid");
    checkpoint = { startIndex, answers, reviewQueue, recovered };
  } catch (error) {
    throw badRequest(error);
  }
  const updatedAt = new Date().toISOString();
  const saved = await repository.savePracticeCheckpoint({
    sub: session.sub,
    runId: run.runId,
    ...checkpoint,
    updatedAt,
    expiresAt: run.expiresAt,
    nowSeconds,
  });
  return json(200, {
    accepted: true,
    runId: run.runId,
    answerCount: saved.answerCount,
    updatedAt: saved.updatedAt,
  });
}

export async function getPracticeResume({
  event,
  config,
  repository,
}: RouteContext) {
  const session = sessionFor(event, config.sessionSecret, true);
  const meta = await repository.getPracticeCheckpoint(session.sub);
  const nowSeconds = Math.floor(Date.now() / 1_000);
  if (!meta || meta.expiresAt <= nowSeconds) return json(200, { draft: null });
  const run = await repository.getRun(meta.runId);
  if (!activePracticeRun(run, session.sub, nowSeconds))
    return json(200, { draft: null });
  const summary = {
    runId: run.runId,
    answerCount: meta.answerCount,
    updatedAt: meta.updatedAt,
    expiresAt: new Date(run.expiresAt * 1_000).toISOString(),
  };
  if (event.queryStringParameters?.summary === "1")
    return json(200, { draft: summary });

  const answers = await repository.listPracticeCheckpointAnswers(
    session.sub,
    run.runId,
  );
  if (answers.length !== meta.answerCount)
    throw new HttpError(
      503,
      "Practice recovery is temporarily incomplete. Try again.",
      "practice_recovery_incomplete",
    );
  const runToken = signToken(
    {
      type: "run",
      runId: run.runId,
      owner: run.owner,
      mode: "practice",
      iat: nowSeconds,
      exp: run.expiresAt + RUN_TOKEN_GRACE_SECONDS,
    },
    config.sessionSecret,
  );
  return json(200, {
    draft: {
      ...summary,
      run: {
        runId: run.runId,
        runToken,
        mode: "practice",
        challenge: run.challenge,
        ranked: false,
        expiresAt: summary.expiresAt,
      },
      answers,
      reviewQueue: meta.reviewQueue,
      recovered: meta.recovered,
    },
  });
}
