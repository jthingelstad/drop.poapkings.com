import type { HttpRequest, HttpResponse } from "../src/http.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signToken } from "../src/signing.js";
const repository = vi.hoisted(() => ({
  getRun: vi.fn(),
  getProfile: vi.fn(),
  useRateLimit: vi.fn(),
}));
vi.mock("../src/repository.js", () => ({
  Repository: class {
    getRun = repository.getRun;
    getProfile = repository.getProfile;
    useRateLimit = repository.useRateLimit;
  },
}));
import { dispatch } from "../src/app.js";
const secret = "test-session-secret";
const nowSeconds = Math.floor(Date.now() / 1000);
function event(runToken: string): HttpRequest {
  const session = signToken(
    {
      type: "session",
      sub: "player-sub",
      iat: nowSeconds - 60,
      exp: nowSeconds + 3600,
    },
    secret,
  );
  return {
    path: "/runs/complete",
    headers: {
      authorization: `Bearer ${session}`,
      "content-type": "application/json",
    },
    method: "POST",
    sourceIp: "127.0.0.1",
    requestId: "request-1",
    body: JSON.stringify({ runToken, transcript: {} }),
  };
}
describe("idempotent run completion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.useRateLimit.mockResolvedValue(undefined);
  });
  it("returns the stored result when a recorded run is retried", async () => {
    const runToken = signToken(
      {
        type: "run",
        runId: "run-1",
        owner: "player-sub",
        mode: "surge",
        iat: nowSeconds - 120,
        exp: nowSeconds + 1800,
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
      expiresAt: nowSeconds + 1800,
      completedAt: "2026-07-18T12:01:00.000Z",
      score: 12345,
      seasonId: 134,
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
    const response = (await dispatch(event(runToken))) as HttpResponse;
    const body = JSON.parse(response.body || "{}");
    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      accepted: true,
      runId: "run-1",
      mode: "surge",
      score: 12345,
      completedAt: "2026-07-18T12:01:00.000Z",
      totalGames: 8,
      season: { id: 134 },
    });
  });
});
