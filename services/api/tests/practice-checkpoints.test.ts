import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import rawCards from "@elixir-drop/game-data/cards.json";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signToken, verifyToken } from "../src/signing.js";

const repository = vi.hoisted(() => ({
  getPracticeCheckpoint: vi.fn(),
  getRun: vi.fn(),
  listPracticeCheckpointAnswers: vi.fn(),
  savePracticeCheckpoint: vi.fn(),
  useRateLimit: vi.fn(),
}));

vi.mock("../src/repository.js", () => ({
  Repository: class {
    getPracticeCheckpoint = repository.getPracticeCheckpoint;
    getRun = repository.getRun;
    listPracticeCheckpointAnswers = repository.listPracticeCheckpointAnswers;
    savePracticeCheckpoint = repository.savePracticeCheckpoint;
    useRateLimit = repository.useRateLimit;
  },
}));

import { handler } from "../src/handler.js";

const secret = "test-session-secret";
const nowSeconds = Math.floor(Date.now() / 1_000);
const catalog = (rawCards as { cards: Array<{ id: number; elixir: number }> })
  .cards;
const run = {
  pk: "RUN#practice-run",
  sk: "RUN" as const,
  runId: "practice-run",
  owner: "player-sub",
  mode: "practice" as const,
  challenge: {
    mode: "practice" as const,
    cardIds: catalog.map((card) => card.id),
  },
  state: "started" as const,
  startedAt: new Date((nowSeconds - 60) * 1_000).toISOString(),
  expiresAt: nowSeconds + 3_600,
  ranked: false,
};

function sessionToken() {
  return signToken(
    {
      type: "session",
      sub: "player-sub",
      iat: nowSeconds - 60,
      exp: nowSeconds + 3_600,
    },
    secret,
  );
}

function runToken() {
  return signToken(
    {
      type: "run",
      runId: run.runId,
      owner: run.owner,
      mode: "practice",
      iat: nowSeconds - 60,
      exp: nowSeconds + 3_600,
    },
    secret,
  );
}

function event(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
  queryStringParameters?: Record<string, string>,
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: queryStringParameters
      ? new URLSearchParams(queryStringParameters).toString()
      : "",
    queryStringParameters,
    headers: {
      authorization: `Bearer ${sessionToken()}`,
      "content-type": "application/json",
    },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test.example",
      domainPrefix: "test",
      http: {
        method,
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "request-1",
      routeKey: "$default",
      stage: "$default",
      time: "25/Aug/2026:19:00:00 +0000",
      timeEpoch: nowSeconds * 1_000,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    isBase64Encoded: false,
  };
}

describe("Practice checkpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.getRun.mockResolvedValue(run);
    repository.useRateLimit.mockResolvedValue(undefined);
  });

  it("stores one verified 20-answer chunk without awarding any progress", async () => {
    const card = catalog[0]!;
    const answers = Array.from({ length: 20 }, () => ({
      cardId: card.id,
      guess: card.elixir,
      responseMs: 900,
      assisted: false,
      // The server never trusts this client projection.
      correct: false,
    }));
    repository.savePracticeCheckpoint.mockImplementation(async (input) => ({
      pk: "PLAYER#player-sub",
      sk: "PRACTICE#ACTIVE",
      runId: run.runId,
      answerCount: input.startIndex + input.answers.length,
      chunkCount: 1,
      reviewQueue: input.reviewQueue,
      recovered: input.recovered,
      updatedAt: input.updatedAt,
      expiresAt: input.expiresAt,
    }));

    const response = (await handler(
      event("POST", "/practice/checkpoint", {
        runToken: runToken(),
        startIndex: 0,
        answers,
        reviewQueue: [],
        recovered: 0,
      }),
      {} as Context,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body || "{}")).toMatchObject({
      accepted: true,
      runId: run.runId,
      answerCount: 20,
    });
    expect(repository.savePracticeCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: "player-sub",
        runId: run.runId,
        startIndex: 0,
        answers: expect.arrayContaining([
          expect.objectContaining({ cardId: card.id, correct: true }),
        ]),
      }),
    );
  });

  it("reports checkpoint storage failures as server errors", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const card = catalog[0]!;
    const answers = Array.from({ length: 20 }, () => ({
      cardId: card.id,
      guess: card.elixir,
      responseMs: 900,
      assisted: false,
    }));
    repository.savePracticeCheckpoint.mockRejectedValue(
      new Error("storage unavailable"),
    );

    const response = (await handler(
      event("POST", "/practice/checkpoint", {
        runToken: runToken(),
        startIndex: 0,
        answers,
        reviewQueue: [],
        recovered: 0,
      }),
      {} as Context,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body || "{}")).toMatchObject({
      error: {
        code: "internal_error",
        message: "The API could not complete the request.",
      },
    });
    expect(error).toHaveBeenCalledWith(
      "API request failed",
      expect.objectContaining({
        path: "/practice/checkpoint",
        statusCode: 500,
        code: "internal_error",
      }),
    );
  });

  it("returns only a lightweight summary for Home", async () => {
    repository.getPracticeCheckpoint.mockResolvedValue({
      pk: "PLAYER#player-sub",
      sk: "PRACTICE#ACTIVE",
      runId: run.runId,
      answerCount: 2600,
      chunkCount: 130,
      reviewQueue: [],
      recovered: 42,
      updatedAt: "2026-08-25T18:57:05.729Z",
      expiresAt: run.expiresAt,
    });

    const response = (await handler(
      event("GET", "/practice/resume", undefined, { summary: "1" }),
      {} as Context,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(response.body || "{}");

    expect(response.statusCode).toBe(200);
    expect(body.draft).toMatchObject({ runId: run.runId, answerCount: 2600 });
    expect(body.draft).not.toHaveProperty("answers");
    expect(repository.listPracticeCheckpointAnswers).not.toHaveBeenCalled();
  });

  it("reissues the signed run and exact checkpoint transcript for resume", async () => {
    const card = catalog[1]!;
    const answers = Array.from({ length: 20 }, () => ({
      cardId: card.id,
      guess: card.elixir,
      responseMs: 1200,
      assisted: false,
      correct: true,
    }));
    repository.getPracticeCheckpoint.mockResolvedValue({
      pk: "PLAYER#player-sub",
      sk: "PRACTICE#ACTIVE",
      runId: run.runId,
      answerCount: 20,
      chunkCount: 1,
      reviewQueue: [],
      recovered: 0,
      updatedAt: "2026-08-25T18:57:05.729Z",
      expiresAt: run.expiresAt,
    });
    repository.listPracticeCheckpointAnswers.mockResolvedValue(answers);

    const response = (await handler(
      event("GET", "/practice/resume"),
      {} as Context,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(response.body || "{}");

    expect(response.statusCode).toBe(200);
    expect(body.draft.answers).toHaveLength(20);
    expect(body.draft.run).toMatchObject({
      runId: run.runId,
      mode: "practice",
      ranked: false,
    });
    expect(verifyToken(body.draft.run.runToken, "run", secret).runId).toBe(
      run.runId,
    );
  });

  it("requires a complete checkpoint and a signed-in owner", async () => {
    const card = catalog[0]!;
    const response = (await handler(
      event("POST", "/practice/checkpoint", {
        runToken: runToken(),
        startIndex: 0,
        answers: [
          {
            cardId: card.id,
            guess: card.elixir,
            responseMs: 500,
            assisted: false,
          },
        ],
        reviewQueue: [],
        recovered: 0,
      }),
      {} as Context,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;

    expect(response.statusCode).toBe(400);
    expect(repository.savePracticeCheckpoint).not.toHaveBeenCalled();
  });
});
