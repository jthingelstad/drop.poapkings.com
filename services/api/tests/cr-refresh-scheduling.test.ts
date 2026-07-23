import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signToken } from "../src/signing.js";

const repository = vi.hoisted(() => ({
  completeRun: vi.fn(),
  consumeMagicLink: vi.fn(),
  ensureProfile: vi.fn(),
  getCardStats: vi.fn(async () => ({})),
  getCrProfile: vi.fn(),
  getCrWarClock: vi.fn(),
  getProfile: vi.fn(),
  getRun: vi.fn(),
  listRecentRuns: vi.fn(),
  peekMagicLink: vi.fn(),
  saveMagicLink: vi.fn(),
  savePollSession: vi.fn(),
  updateProfile: vi.fn(),
  useRateLimit: vi.fn(),
}));
const requestCrProfileRefresh = vi.hoisted(() => vi.fn());
const enrollButtondownSubscriber = vi.hoisted(() => vi.fn());
const sendMagicLink = vi.hoisted(() => vi.fn());

vi.mock("../src/repository.js", () => ({
  Repository: class {
    completeRun = repository.completeRun;
    consumeMagicLink = repository.consumeMagicLink;
    ensureProfile = repository.ensureProfile;
    getCardStats = repository.getCardStats;
    getCrProfile = repository.getCrProfile;
    getCrWarClock = repository.getCrWarClock;
    getProfile = repository.getProfile;
    getRun = repository.getRun;
    listRecentRuns = repository.listRecentRuns;
    peekMagicLink = repository.peekMagicLink;
    saveMagicLink = repository.saveMagicLink;
    savePollSession = repository.savePollSession;
    updateProfile = repository.updateProfile;
    useRateLimit = repository.useRateLimit;
  },
}));

vi.mock("../src/buttondown.js", () => ({
  deleteButtondownSubscriber: vi.fn(),
  enrollButtondownSubscriber,
}));

vi.mock("../src/jmap.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/jmap.js")>();
  return { ...actual, sendMagicLink };
});

vi.mock("../src/cr-refresh.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/cr-refresh.js")>();
  return { ...actual, requestCrProfileRefresh };
});

import { handler } from "../src/handler.js";

const secret = "test-session-secret";
const nowSeconds = Math.floor(Date.now() / 1_000);
const profile = {
  sub: "player-sub",
  playerId: "player-1",
  email: "player@example.com",
  publicName: "Knight Main",
  favoriteCardId: 26000000,
  playerTag: "#2PYQ0",
  totalGames: 4,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-18T12:00:00.000Z",
};
const snapshot = {
  tag: "#2PYQ0",
  status: "ready" as const,
  name: "Player One",
  cards: [],
  fetchedAt: "2026-07-18T12:00:00.000Z",
};

function event(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: Record<string, unknown>,
  authenticated = false,
): APIGatewayProxyEventV2 {
  const session = signToken(
    {
      type: "session",
      sub: profile.sub,
      iat: nowSeconds - 60,
      exp: nowSeconds + 3_600,
    },
    secret,
  );
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      ...(authenticated ? { authorization: `Bearer ${session}` } : {}),
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
      time: "18/Jul/2026:12:00:00 +0000",
      timeEpoch: nowSeconds * 1_000,
    },
    body: body ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
  };
}

async function invoke(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: Record<string, unknown>,
  authenticated = false,
): Promise<APIGatewayProxyStructuredResultV2> {
  return (await handler(
    event(method, path, body, authenticated),
    {} as Context,
    vi.fn(),
  )) as APIGatewayProxyStructuredResultV2;
}

describe("Clash Royale refresh scheduling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.BUTTONDOWN_API_KEY = "buttondown-key";
    process.env.BUTTONDOWN_NEWSLETTER_ID = "news_2d3heqk1789vyatbxaeg4b2c91";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.getCrProfile.mockResolvedValue(snapshot);
    repository.getCrWarClock.mockResolvedValue(undefined);
    requestCrProfileRefresh.mockResolvedValue(snapshot);
    sendMagicLink.mockResolvedValue(undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  it("refreshes an attached tag after a successful magic-link login", async () => {
    repository.peekMagicLink.mockResolvedValue({ email: profile.email });
    repository.consumeMagicLink.mockResolvedValue(profile.email);
    repository.ensureProfile.mockResolvedValue({ profile, created: false });

    const response = await invoke("POST", "/auth/redeem", {
      token: "a".repeat(32),
    });

    expect(response.statusCode).toBe(200);
    expect(requestCrProfileRefresh).toHaveBeenCalledWith(
      expect.anything(),
      "https://sqs.example/requests",
      profile.playerTag,
    );
    expect(enrollButtondownSubscriber).toHaveBeenCalledWith(
      {
        apiKey: "buttondown-key",
        newsletterId: "news_2d3heqk1789vyatbxaeg4b2c91",
      },
      profile.email,
    );
  });

  it("does not enroll an address when a magic link is only requested", async () => {
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.saveMagicLink.mockResolvedValue(undefined);

    const response = await invoke("POST", "/auth/request", {
      email: profile.email,
    });

    expect(response.statusCode).toBe(202);
    expect(sendMagicLink).toHaveBeenCalledOnce();
    expect(enrollButtondownSubscriber).not.toHaveBeenCalled();
  });

  it("hands the new session to a waiting poll id (cross-context/PWA login)", async () => {
    repository.peekMagicLink.mockResolvedValue({
      email: profile.email,
      pollId: "poll-abc",
    });
    repository.consumeMagicLink.mockResolvedValue(profile.email);
    repository.ensureProfile.mockResolvedValue({ profile, created: false });

    const response = await invoke("POST", "/auth/redeem", {
      token: "a".repeat(32),
    });

    expect(response.statusCode).toBe(200);
    const session = JSON.parse(response.body ?? "{}").session;
    expect(repository.savePollSession).toHaveBeenCalledWith(
      "poll-abc",
      session,
      expect.any(Number),
    );
  });

  it("does not write a poll session when the link carries no poll id", async () => {
    repository.peekMagicLink.mockResolvedValue({ email: profile.email });
    repository.consumeMagicLink.mockResolvedValue(profile.email);
    repository.ensureProfile.mockResolvedValue({ profile, created: false });

    await invoke("POST", "/auth/redeem", { token: "a".repeat(32) });
    expect(repository.savePollSession).not.toHaveBeenCalled();
  });

  it("does not burn the magic link when the durable login work fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    repository.peekMagicLink.mockResolvedValue({ email: profile.email });
    repository.ensureProfile.mockRejectedValue(new Error("dynamo down"));

    const response = await invoke("POST", "/auth/redeem", {
      token: "a".repeat(32),
    });

    expect(response.statusCode).toBe(500);
    // The single-use link must stay redeemable for the retry click.
    expect(repository.consumeMagicLink).not.toHaveBeenCalled();
    expect(enrollButtondownSubscriber).not.toHaveBeenCalled();
  });

  it("serves cached CR data without refreshing on a profile read", async () => {
    repository.getProfile.mockResolvedValue(profile);
    repository.listRecentRuns.mockResolvedValue([]);

    const response = await invoke("GET", "/me", undefined, true);

    expect(response.statusCode).toBe(200);
    expect(repository.getCrProfile).toHaveBeenCalledWith(profile.playerTag);
    expect(requestCrProfileRefresh).not.toHaveBeenCalled();
  });

  it("fetches a tag when the player explicitly saves it", async () => {
    repository.updateProfile.mockResolvedValue(profile);

    const response = await invoke(
      "PATCH",
      "/me",
      { playerTag: profile.playerTag },
      true,
    );

    expect(response.statusCode).toBe(200);
    expect(requestCrProfileRefresh).toHaveBeenCalledWith(
      expect.anything(),
      "https://sqs.example/requests",
      profile.playerTag,
    );
  });

  it("accepts a safe signed card-inspired name without the exact card title", async () => {
    const favoriteCardId = 26000018;
    const publicName = "Pancake Patrol";
    const nameToken = signToken(
      {
        type: "names",
        sub: profile.sub,
        favoriteCardId,
        names: [publicName, "Mini P Griddle"],
        iat: nowSeconds - 60,
        exp: nowSeconds + 900,
      },
      secret,
    );
    repository.updateProfile.mockResolvedValue({
      ...profile,
      favoriteCardId,
      publicName,
    });

    const response = await invoke(
      "PATCH",
      "/me",
      { favoriteCardId, publicName, nameToken },
      true,
    );

    expect(response.statusCode).toBe(200);
    expect(repository.updateProfile).toHaveBeenCalledWith(profile.sub, {
      favoriteCardId,
      publicName,
    });
  });

  it("reads cached CR identity after a game without requesting a refresh", async () => {
    repository.getCrWarClock.mockResolvedValue({
      crSeasonId: 134,
      sectionIndex: 1,
      periodIndex: 12,
      periodType: "warDay",
      seasonStartsAt: "2026-07-06T10:00:00.000Z",
      observedAt: new Date().toISOString(),
      sourceClanTag: "#J2RGCRVG",
      leaderboardSeasonId: "2026-07",
      updatedAt: new Date().toISOString(),
    });
    const runToken = signToken(
      {
        type: "run",
        runId: "run-1",
        owner: profile.sub,
        mode: "practice",
        iat: nowSeconds - 60,
        exp: nowSeconds + 1_800,
      },
      secret,
    );
    repository.getRun.mockResolvedValue({
      pk: "RUN#run-1",
      sk: "RUN",
      runId: "run-1",
      owner: profile.sub,
      mode: "practice",
      challenge: { mode: "practice", cardIds: [26000000] },
      state: "started",
      startedAt: new Date(nowSeconds * 1_000 - 60_000).toISOString(),
      expiresAt: nowSeconds + 1_800,
    });
    repository.completeRun.mockResolvedValue({
      totalGames: 5,
      completedAt: "2026-07-18T12:01:00.000Z",
      profile: { ...profile, totalGames: 5 },
    });

    const response = await invoke(
      "POST",
      "/runs/complete",
      {
        runToken,
        transcript: {
          answers: [{ cardId: 26000000, guess: 3 }],
        },
      },
      true,
    );

    expect(response.statusCode).toBe(201);
    expect(repository.completeRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Number),
      "2026-07",
      expect.any(Number),
      undefined, // no Survival time tiebreak for a Practice run
      undefined, // no automatic referee quarantine for a valid Practice run
    );
    expect(JSON.parse(response.body || "{}").season).toMatchObject({
      source: "clash-royale",
      crSeasonId: 134,
      currentWeek: 2,
    });
    expect(repository.getCrProfile).toHaveBeenCalledWith(profile.playerTag);
    expect(requestCrProfileRefresh).not.toHaveBeenCalled();
  });
});
