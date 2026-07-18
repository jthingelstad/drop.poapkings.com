import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signToken } from "../src/signing.js";

const repository = vi.hoisted(() => ({
  getRun: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock("../src/repository.js", () => ({
  Repository: class {
    getRun = repository.getRun;
    getProfile = repository.getProfile;
  },
}));

import { handler } from "../src/handler.js";

const secret = "test-session-secret";
const nowSeconds = Math.floor(Date.now() / 1_000);

function event(runToken: string): APIGatewayProxyEventV2 {
  const session = signToken(
    {
      type: "session",
      sub: "player-sub",
      iat: nowSeconds - 60,
      exp: nowSeconds + 3_600,
    },
    secret,
  );
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: "/runs/complete",
    rawQueryString: "",
    headers: {
      authorization: `Bearer ${session}`,
      "content-type": "application/json",
    },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test.example",
      domainPrefix: "test",
      http: {
        method: "POST",
        path: "/runs/complete",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "request-1",
      routeKey: "$default",
      stage: "$default",
      time: "18/Jul/2026:12:05:00 +0000",
      timeEpoch: nowSeconds * 1_000,
    },
    body: JSON.stringify({ runToken, transcript: {} }),
    isBase64Encoded: false,
  };
}

describe("idempotent run completion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.APP_URL = "https://drop.example";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
  });

  it("returns the stored result when a recorded run is retried", async () => {
    const runToken = signToken(
      {
        type: "run",
        runId: "run-1",
        owner: "player-sub",
        mode: "surge",
        iat: nowSeconds - 120,
        exp: nowSeconds + 1_800,
      },
      secret,
    );
    repository.getRun.mockResolvedValue({
      pk: "RUN#run-1",
      sk: "RUN",
      runId: "run-1",
      owner: "player-sub",
      mode: "surge",
      challenge: { mode: "surge", cardIds: [] },
      state: "completed",
      startedAt: "2026-07-18T12:00:00.000Z",
      expiresAt: nowSeconds + 1_800,
      completedAt: "2026-07-18T12:01:00.000Z",
      score: 12_345,
      seasonId: "2026-07",
    });
    repository.getProfile.mockResolvedValue({
      sub: "player-sub",
      playerId: "player-1",
      email: "player@example.com",
      publicName: "Knight Main",
      favoriteCardId: 26000000,
      totalGames: 8,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-18T12:01:00.000Z",
    });

    const response = (await handler(
      event(runToken),
      {} as Context,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;
    const body = JSON.parse(response.body || "{}");

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      accepted: true,
      runId: "run-1",
      mode: "surge",
      score: 12_345,
      completedAt: "2026-07-18T12:01:00.000Z",
      totalGames: 8,
      season: { id: "2026-07" },
    });
  });
});
