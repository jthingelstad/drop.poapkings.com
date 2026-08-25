import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signToken } from "../src/signing.js";
import { emailSubject } from "../src/validation.js";

const repository = vi.hoisted(() => ({
  attachRecruiter: vi.fn(),
  creditRecruiter: vi.fn(),
  completeRun: vi.fn(),
  consumeMagicLink: vi.fn(),
  deleteMagicLink: vi.fn(),
  ensureProfile: vi.fn(),
  getCardStats: vi.fn(async () => ({})),
  getCrProfile: vi.fn(),
  getCrWarClock: vi.fn(),
  getProfile: vi.fn(),
  getPublishedBadgeShare: vi.fn(),
  getPublishedProfileShare: vi.fn(),
  getPublishedRunShare: vi.fn(),
  getRecruiterInvite: vi.fn(),
  getRun: vi.fn(),
  getShare: vi.fn(),
  listRecentRuns: vi.fn(),
  peekMagicLink: vi.fn(),
  saveMagicLink: vi.fn(),
  savePollSession: vi.fn(),
  putRecruiterInviteAlias: vi.fn(),
  updateProfile: vi.fn(),
  useRateLimit: vi.fn(),
  wouldLeadAllTime: vi.fn(async () => false),
  wouldLeadSeason: vi.fn(async () => false),
  rankedAccess: vi.fn(async () => "allowed" as const),
  refereeDecisions: vi.fn(async () => new Map()),
}));
const requestCrProfileRefresh = vi.hoisted(() => vi.fn());
const enrollButtondownSubscriber = vi.hoisted(() => vi.fn());
const updateButtondownSubscriberMetadata = vi.hoisted(() => vi.fn());
const sendMagicLink = vi.hoisted(() => vi.fn());
const publishTinylyticsEvent = vi.hoisted(() => vi.fn());

vi.mock("../src/repository.js", () => ({
  Repository: class {
    attachRecruiter = repository.attachRecruiter;
    creditRecruiter = repository.creditRecruiter;
    completeRun = repository.completeRun;
    consumeMagicLink = repository.consumeMagicLink;
    deleteMagicLink = repository.deleteMagicLink;
    ensureProfile = repository.ensureProfile;
    getCardStats = repository.getCardStats;
    getCrProfile = repository.getCrProfile;
    getCrWarClock = repository.getCrWarClock;
    getProfile = repository.getProfile;
    getPublishedBadgeShare = repository.getPublishedBadgeShare;
    getPublishedProfileShare = repository.getPublishedProfileShare;
    getPublishedRunShare = repository.getPublishedRunShare;
    getRecruiterInvite = repository.getRecruiterInvite;
    getRun = repository.getRun;
    getShare = repository.getShare;
    listRecentRuns = repository.listRecentRuns;
    peekMagicLink = repository.peekMagicLink;
    saveMagicLink = repository.saveMagicLink;
    savePollSession = repository.savePollSession;
    putRecruiterInviteAlias = repository.putRecruiterInviteAlias;
    updateProfile = repository.updateProfile;
    useRateLimit = repository.useRateLimit;
    wouldLeadAllTime = repository.wouldLeadAllTime;
    wouldLeadSeason = repository.wouldLeadSeason;
    rankedAccess = repository.rankedAccess;
    refereeDecisions = repository.refereeDecisions;
  },
}));

vi.mock("../src/buttondown.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/buttondown.js")>();
  return {
    ...actual,
    deleteButtondownSubscriber: vi.fn(),
    enrollButtondownSubscriber,
    updateButtondownSubscriberMetadata,
  };
});

vi.mock("../src/jmap.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/jmap.js")>();
  return { ...actual, sendMagicLink };
});

vi.mock("../src/cr-refresh.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/cr-refresh.js")>();
  return { ...actual, requestCrProfileRefresh };
});

vi.mock("../src/tinylytics.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/tinylytics.js")>();
  return { ...actual, publishTinylyticsEvent };
});

import { handler } from "../src/handler.js";

const secret = "test-session-secret";
const nowSeconds = Math.floor(Date.now() / 1_000);
const profile = {
  sub: "player-sub",
  playerId: "11111111-1111-4111-8111-111111111111",
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
  clan: { tag: "#J2RGCRVG", name: "POAP KINGS", badgeId: 16000000 },
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
    process.env.TINYLYTICS_API_TOKEN = "tinylytics-key";
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
      {
        playerTag: profile.playerTag,
        dropPlayerTag: "#P7H47PSTT93",
        recruiterUrl: "https://drop.example/share/P7H47PSTT93/invite",
        clanTag: "#J2RGCRVG",
        clanName: "POAP KINGS",
        totalGames: 4,
      },
    );
    expect(publishTinylyticsEvent).toHaveBeenCalledWith(
      { apiToken: "tinylytics-key" },
      expect.objectContaining({ rawPath: "/auth/redeem" }),
      {
        event: "account.login_completed",
        value: "returning",
        path: "/login",
      },
    );
  });

  it("refreshes Buttondown metadata when an existing session returns", async () => {
    repository.getProfile.mockResolvedValue(profile);

    const response = await invoke("POST", "/auth/refresh", undefined, true);

    expect(response.statusCode).toBe(200);
    expect(updateButtondownSubscriberMetadata).toHaveBeenCalledWith(
      {
        apiKey: "buttondown-key",
        newsletterId: "news_2d3heqk1789vyatbxaeg4b2c91",
      },
      profile.email,
      {
        playerTag: profile.playerTag,
        dropPlayerTag: "#P7H47PSTT93",
        recruiterUrl: "https://drop.example/share/P7H47PSTT93/invite",
        clanTag: "#J2RGCRVG",
        clanName: "POAP KINGS",
        totalGames: 4,
      },
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
    expect(publishTinylyticsEvent).toHaveBeenCalledWith(
      { apiToken: "tinylytics-key" },
      expect.objectContaining({ rawPath: "/auth/request" }),
      { event: "account.login_requested", path: "/login" },
    );
  });

  it("carries the exact player-tag editor into the magic link", async () => {
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.saveMagicLink.mockResolvedValue(undefined);

    const response = await invoke("POST", "/auth/request", {
      email: profile.email,
      returnTo: "/profile?edit=player-tag",
    });

    expect(response.statusCode).toBe(202);
    expect(sendMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        magicLink: expect.stringMatching(
          /^https:\/\/drop\.example\/#\/auth\?token=[^&]+&returnTo=%2Fprofile%3Fedit%3Dplayer-tag$/,
        ),
      }),
    );
  });

  it("carries a valid attributed share into a new account's magic link", async () => {
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.getProfile.mockResolvedValue(undefined);
    repository.getShare.mockResolvedValue({
      token: "AB2CD3",
      owner: "recruiter-sub",
    });
    repository.saveMagicLink.mockResolvedValue(undefined);

    const response = await invoke("POST", "/auth/request", {
      email: "new-player@example.com",
      recruiterToken: "ab2cd3",
    });

    expect(response.statusCode).toBe(202);
    expect(repository.getShare).toHaveBeenCalledWith("AB2CD3");
    expect(repository.saveMagicLink).toHaveBeenCalledWith(
      expect.any(String),
      "new-player@example.com",
      expect.any(Number),
      expect.any(String),
      "recruiter-sub",
    );
  });

  it("carries a deterministic run share into a new account's magic link", async () => {
    const playerId = "11111111-1111-4111-8111-111111111111";
    const runId = "22222222-2222-4222-8222-222222222222";
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.getProfile.mockResolvedValue(undefined);
    repository.getPublishedRunShare.mockResolvedValue({
      playerId,
      runId,
      owner: "recruiter-sub",
    });
    repository.refereeDecisions.mockResolvedValue(new Map());
    repository.saveMagicLink.mockResolvedValue(undefined);

    const response = await invoke("POST", "/auth/request", {
      email: "new-player@example.com",
      recruiterShare: { playerId, runId },
    });

    expect(response.statusCode).toBe(202);
    expect(repository.getPublishedRunShare).toHaveBeenCalledWith(
      playerId,
      runId,
    );
    expect(repository.saveMagicLink).toHaveBeenCalledWith(
      expect.any(String),
      "new-player@example.com",
      expect.any(Number),
      expect.any(String),
      "recruiter-sub",
    );
  });

  it("carries a deterministic badge share into a new account's magic link", async () => {
    const playerId = "11111111-1111-4111-8111-111111111111";
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.getProfile.mockResolvedValue(undefined);
    repository.getPublishedBadgeShare.mockResolvedValue({
      playerId,
      slug: "clockbreaker",
      rungIndex: 3,
      owner: "recruiter-sub",
    });
    repository.saveMagicLink.mockResolvedValue(undefined);

    const response = await invoke("POST", "/auth/request", {
      email: "new-player@example.com",
      recruiterShare: { playerId, badgeSlug: "clockbreaker", rungIndex: 3 },
    });

    expect(response.statusCode).toBe(202);
    expect(repository.getPublishedBadgeShare).toHaveBeenCalledWith(
      playerId,
      "clockbreaker",
      3,
    );
    expect(repository.saveMagicLink).toHaveBeenCalledWith(
      expect.any(String),
      "new-player@example.com",
      expect.any(Number),
      expect.any(String),
      "recruiter-sub",
    );
  });

  it("carries a published profile share into a new account's magic link", async () => {
    const playerId = "11111111-1111-4111-8111-111111111111";
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.getProfile.mockResolvedValue(undefined);
    repository.getPublishedProfileShare.mockResolvedValue({
      playerId,
      owner: "recruiter-sub",
    });
    repository.saveMagicLink.mockResolvedValue(undefined);

    const response = await invoke("POST", "/auth/request", {
      email: "new-player@example.com",
      recruiterShare: { playerId, profile: true },
    });

    expect(response.statusCode).toBe(202);
    expect(repository.getPublishedProfileShare).toHaveBeenCalledWith(playerId);
    expect(repository.saveMagicLink).toHaveBeenCalledWith(
      expect.any(String),
      "new-player@example.com",
      expect.any(Number),
      expect.any(String),
      "recruiter-sub",
    );
  });

  it("carries a stable Drop player invitation into a new account's magic link", async () => {
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.getProfile.mockResolvedValue(undefined);
    repository.getRecruiterInvite.mockResolvedValue({
      sub: "recruiter-sub",
      player: { id: profile.playerId },
    });
    repository.saveMagicLink.mockResolvedValue(undefined);

    const response = await invoke("POST", "/auth/request", {
      email: "new-player@example.com",
      recruiterShare: { dropPlayerTag: "P7H47PSTT93", invite: true },
    });

    expect(response.statusCode).toBe(202);
    expect(repository.getRecruiterInvite).toHaveBeenCalledWith("P7H47PSTT93");
    expect(repository.saveMagicLink).toHaveBeenCalledWith(
      expect.any(String),
      "new-player@example.com",
      expect.any(Number),
      expect.any(String),
      "recruiter-sub",
    );
  });

  it("does not attach share recruitment to an existing account", async () => {
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.getProfile.mockResolvedValue(profile);
    repository.getShare.mockResolvedValue({
      token: "AB2CD3",
      owner: "recruiter-sub",
    });
    repository.saveMagicLink.mockResolvedValue(undefined);

    const response = await invoke("POST", "/auth/request", {
      email: profile.email,
      recruiterToken: "AB2CD3",
    });

    expect(response.statusCode).toBe(202);
    expect(repository.saveMagicLink).toHaveBeenCalledWith(
      expect.any(String),
      profile.email,
      expect.any(Number),
      expect.any(String),
      undefined,
    );
  });

  it("credits Recruiter when the attributed account is created", async () => {
    repository.peekMagicLink.mockResolvedValue({
      email: "new-player@example.com",
      recruiterSub: "recruiter-sub",
    });
    repository.ensureProfile.mockResolvedValue({
      profile: { ...profile, email: "new-player@example.com" },
      created: true,
    });
    repository.attachRecruiter.mockResolvedValue(true);
    repository.creditRecruiter.mockResolvedValue(true);
    repository.consumeMagicLink.mockResolvedValue("new-player@example.com");

    const response = await invoke("POST", "/auth/redeem", {
      token: "a".repeat(32),
    });

    expect(response.statusCode).toBe(200);
    expect(repository.attachRecruiter).toHaveBeenCalledWith(
      emailSubject("new-player@example.com"),
      "recruiter-sub",
    );
    expect(repository.creditRecruiter).toHaveBeenCalledWith(
      emailSubject("new-player@example.com"),
      expect.any(String),
    );
    expect(repository.attachRecruiter.mock.invocationCallOrder[0]).toBeLessThan(
      repository.creditRecruiter.mock.invocationCallOrder[0]!,
    );
    expect(repository.creditRecruiter.mock.invocationCallOrder[0]).toBeLessThan(
      repository.consumeMagicLink.mock.invocationCallOrder[0]!,
    );
  });

  it("does not strand account creation when Recruiter credit needs reconciliation", async () => {
    repository.peekMagicLink.mockResolvedValue({
      email: "new-player@example.com",
      recruiterSub: "recruiter-sub",
    });
    repository.ensureProfile.mockResolvedValue({
      profile: { ...profile, email: "new-player@example.com" },
      created: true,
    });
    repository.attachRecruiter.mockResolvedValue(true);
    repository.creditRecruiter.mockRejectedValueOnce(
      new Error("temporary DynamoDB failure"),
    );
    repository.consumeMagicLink.mockResolvedValue("new-player@example.com");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await invoke("POST", "/auth/redeem", {
      token: "a".repeat(32),
    });

    expect(response.statusCode).toBe(200);
    expect(repository.consumeMagicLink).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "Recruiter account-creation credit failed",
      expect.objectContaining({ error: "Error" }),
    );
    warn.mockRestore();
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
    expect(updateButtondownSubscriberMetadata).toHaveBeenCalledWith(
      expect.anything(),
      profile.email,
      {
        playerTag: profile.playerTag,
        dropPlayerTag: "#P7H47PSTT93",
        recruiterUrl: "https://drop.example/share/P7H47PSTT93/invite",
        clanTag: "#J2RGCRVG",
        clanName: "POAP KINGS",
        totalGames: 4,
      },
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
      { practiceCards: 1 },
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
