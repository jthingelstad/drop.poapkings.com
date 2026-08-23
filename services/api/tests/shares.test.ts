import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signToken } from "../src/signing.js";
import {
  isShareToken,
  mintShareToken,
  normalizeShareSeries,
  SHARE_SERIES_MAX,
} from "../src/shares.js";

const repository = vi.hoisted(() => ({
  useRateLimit: vi.fn(),
  getRun: vi.fn(),
  getProfile: vi.fn(),
  putShare: vi.fn(),
  getShare: vi.fn(),
  getPublicPlayer: vi.fn(),
  creditShareOpen: vi.fn(),
  addHeraldOpens: vi.fn(),
}));

vi.mock("../src/repository.js", () => ({
  Repository: class {
    useRateLimit = repository.useRateLimit;
    getRun = repository.getRun;
    getProfile = repository.getProfile;
    putShare = repository.putShare;
    getShare = repository.getShare;
    getPublicPlayer = repository.getPublicPlayer;
    creditShareOpen = repository.creditShareOpen;
    addHeraldOpens = repository.addHeraldOpens;
  },
}));

import { handler } from "../src/handler.js";

const secret = "test-session-secret";
const nowSeconds = Math.floor(Date.now() / 1_000);

function session(sub: string): string {
  return signToken(
    { type: "session", sub, iat: nowSeconds, exp: nowSeconds + 3_600 },
    secret,
  );
}

function event(
  method: string,
  path: string,
  options: {
    sub?: string;
    body?: Record<string, unknown>;
    ip?: string;
    userAgent?: string;
  } = {},
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      ...(options.sub
        ? { authorization: `Bearer ${session(options.sub)}` }
        : {}),
      ...(options.userAgent ? { "user-agent": options.userAgent } : {}),
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
        sourceIp: options.ip ?? "127.0.0.1",
        userAgent: options.userAgent ?? "vitest",
      },
      requestId: "request-1",
      routeKey: "$default",
      stage: "$default",
      time: "19/Aug/2026:12:05:00 +0000",
      timeEpoch: nowSeconds * 1_000,
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

async function call(input: APIGatewayProxyEventV2) {
  return (await handler(
    input,
    {} as Context,
    vi.fn(),
  )) as APIGatewayProxyStructuredResultV2;
}

const completedRun = {
  pk: "RUN#run-1",
  sk: "RUN" as const,
  runId: "run-1",
  owner: "player-sub",
  mode: "surge" as const,
  challenge: { mode: "surge" as const, cardIds: [] },
  state: "completed" as const,
  startedAt: "2026-08-19T12:00:00.000Z",
  expiresAt: nowSeconds + 3_600,
  score: 17_412,
  seasonId: "2026-08",
  completedAt: "2026-08-19T12:00:20.000Z",
};

describe("share tokens", () => {
  it("mints six characters with no look-alike glyphs", () => {
    for (let i = 0; i < 200; i += 1) {
      const token = mintShareToken();
      expect(token).toHaveLength(6);
      expect(isShareToken(token)).toBe(true);
      // A player may end up reading one of these aloud.
      expect(token).not.toMatch(/[ILOU01]/);
    }
  });

  it("bounds the run shape a stranger's browser will render", () => {
    expect(normalizeShareSeries([1.4, -20, 9e9])).toEqual([1, 0, 3_600_000]);
    expect(normalizeShareSeries([])).toBeUndefined();
    expect(normalizeShareSeries(["nope"])).toBeUndefined();
    expect(
      normalizeShareSeries(Array.from({ length: 90 }, () => 100)),
    ).toHaveLength(SHARE_SERIES_MAX);
  });
});

describe("POST /runs/{runId}/share", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.getProfile.mockResolvedValue({
      sub: "player-sub",
      playerId: "public-uuid",
    });
  });

  it("mints a token against a recorded run the caller owns", async () => {
    repository.getRun.mockResolvedValue(completedRun);

    const response = await call(
      event("POST", "/runs/run-1/share", {
        sub: "player-sub",
        body: { series: [1200, 900] },
      }),
    );

    expect(response.statusCode).toBe(201);
    const token = (JSON.parse(response.body ?? "{}") as { token: string })
      .token;
    expect(isShareToken(token)).toBe(true);
    const stored = repository.putShare.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(stored.kind).toBe("run");
    expect(stored.runId).toBe("run-1");
    expect(stored.playerId).toBe("public-uuid");
    expect(stored.score).toBe(17_412);
    expect(stored.series).toEqual([1200, 900]);
  });

  it("mints a NEW token every time, so reach counts per share not per run", async () => {
    repository.getRun.mockResolvedValue(completedRun);

    const first = await call(
      event("POST", "/runs/run-1/share", { sub: "player-sub" }),
    );
    const second = await call(
      event("POST", "/runs/run-1/share", { sub: "player-sub" }),
    );

    expect(JSON.parse(first.body ?? "{}").token).not.toBe(
      JSON.parse(second.body ?? "{}").token,
    );
  });

  it("refuses a run the caller does not own", async () => {
    repository.getRun.mockResolvedValue(completedRun);

    const response = await call(
      event("POST", "/runs/run-1/share", { sub: "someone-else" }),
    );

    expect(response.statusCode).toBe(404);
    expect(repository.putShare).not.toHaveBeenCalled();
  });

  it("refuses a guest run: no server record, so no permalink can exist", async () => {
    repository.getRun.mockResolvedValue({ ...completedRun, guest: true });

    const response = await call(
      event("POST", "/runs/run-1/share", { sub: "player-sub" }),
    );

    expect(response.statusCode).toBe(409);
    expect(repository.putShare).not.toHaveBeenCalled();
  });

  it("refuses a run that has not finished scoring", async () => {
    repository.getRun.mockResolvedValue({
      ...completedRun,
      state: "started",
      score: undefined,
    });

    const response = await call(
      event("POST", "/runs/run-1/share", { sub: "player-sub" }),
    );

    expect(response.statusCode).toBe(409);
  });

  it("requires a session", async () => {
    const response = await call(event("POST", "/runs/run-1/share"));
    expect(response.statusCode).toBe(401);
  });
});

describe("POST /shares", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.getProfile.mockResolvedValue({
      sub: "player-sub",
      playerId: "owner-uuid",
    });
  });

  it("mints a Recruiter-only invitation for Home", async () => {
    const response = await call(
      event("POST", "/shares", {
        sub: "player-sub",
        body: { destination: "home" },
      }),
    );

    expect(response.statusCode).toBe(201);
    expect(repository.putShare).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "invite",
        owner: "player-sub",
        destination: "home",
      }),
    );
    expect(repository.putShare.mock.calls[0]![0]).not.toHaveProperty("runId");
  });

  it("mints a profile invitation only for a real public player", async () => {
    repository.getPublicPlayer.mockResolvedValue({
      sub: "badge-owner-sub",
      player: { id: "badge-owner", publicName: "Badge Owner" },
    });

    const response = await call(
      event("POST", "/shares", {
        sub: "player-sub",
        body: { destination: "player", playerId: "badge-owner" },
      }),
    );

    expect(response.statusCode).toBe(201);
    expect(repository.putShare).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "invite",
        owner: "player-sub",
        destination: "player",
        destinationPlayerId: "badge-owner",
      }),
    );
  });

  it("requires an account session", async () => {
    expect((await call(event("POST", "/shares"))).statusCode).toBe(401);
  });
});

describe("GET /shares/{token}", () => {
  const share = {
    pk: "SHARE#AB2CD3",
    sk: "SHARE" as const,
    token: "AB2CD3",
    runId: "run-1",
    owner: "player-sub",
    playerId: "public-uuid",
    mode: "surge" as const,
    score: 17_412,
    seasonId: "2026-08",
    completedAt: "2026-08-19T12:00:20.000Z",
    mintedAt: "2026-08-19T12:00:30.000Z",
    series: [1200, 900],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.getShare.mockResolvedValue(share);
    repository.getPublicPlayer.mockResolvedValue({
      sub: "player-sub",
      player: {
        id: "public-uuid",
        publicName: "Drop King",
        totalGames: 40,
        xp: 900,
        level: 4,
      },
    });
    repository.creditShareOpen.mockResolvedValue(true);
  });

  it("returns only what the public profile already shows, and credits the open", async () => {
    const response = await call(
      event("GET", "/shares/AB2CD3", { ip: "8.8.8.8", userAgent: "Safari" }),
    );

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body ?? "{}") as Record<string, unknown>;
    expect(body.score).toBe(17_412);
    expect(body.mode).toBe("surge");
    expect(body.series).toEqual([1200, 900]);
    expect(body.player).toMatchObject({ publicName: "Drop King" });
    // Never the subject key, never the run's transcript.
    expect(JSON.stringify(body)).not.toContain("player-sub");
    expect(body.owner).toBeUndefined();
    expect(repository.addHeraldOpens).toHaveBeenCalledWith("player-sub", 1);
  });

  it("resolves an invitation without granting Herald credit or fingerprinting the visitor", async () => {
    repository.getShare.mockResolvedValue({
      pk: "SHARE#AB2CD3",
      sk: "SHARE",
      token: "AB2CD3",
      kind: "invite",
      owner: "player-sub",
      destination: "player",
      destinationPlayerId: "badge-owner",
      mintedAt: "2026-08-22T12:00:00.000Z",
    });

    const response = await call(
      event("GET", "/shares/AB2CD3", {
        ip: "8.8.8.8",
        userAgent: "Safari",
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toEqual({
      token: "AB2CD3",
      kind: "invite",
      destination: "player",
      playerId: "badge-owner",
    });
    expect(repository.creditShareOpen).not.toHaveBeenCalled();
    expect(repository.addHeraldOpens).not.toHaveBeenCalled();
  });

  it("keys the visitor by a peppered hash, never a raw IP or user-agent", async () => {
    await call(
      event("GET", "/shares/AB2CD3", { ip: "8.8.8.8", userAgent: "Safari" }),
    );

    const [, visitorHash] = repository.creditShareOpen.mock.calls[0]!;
    expect(visitorHash).not.toContain("8.8.8.8");
    expect(visitorHash).not.toContain("Safari");

    // The same visitor hashes the same way, so a refresh dedupes.
    repository.creditShareOpen.mockClear();
    await call(
      event("GET", "/shares/AB2CD3", { ip: "8.8.8.8", userAgent: "Safari" }),
    );
    expect(repository.creditShareOpen.mock.calls[0]![1]).toBe(visitorHash);

    // A different visitor does not.
    repository.creditShareOpen.mockClear();
    await call(
      event("GET", "/shares/AB2CD3", { ip: "9.9.9.9", userAgent: "Safari" }),
    );
    expect(repository.creditShareOpen.mock.calls[0]![1]).not.toBe(visitorHash);
  });

  it("drops the sharer's own device", async () => {
    const response = await call(
      event("GET", "/shares/AB2CD3", { sub: "player-sub" }),
    );

    expect(response.statusCode).toBe(200);
    expect(repository.creditShareOpen).not.toHaveBeenCalled();
    expect(repository.addHeraldOpens).not.toHaveBeenCalled();
  });

  it("pays nothing for a repeat visitor, but still opens the link", async () => {
    repository.creditShareOpen.mockResolvedValue(false);

    const response = await call(event("GET", "/shares/AB2CD3"));

    expect(response.statusCode).toBe(200);
    expect(repository.addHeraldOpens).not.toHaveBeenCalled();
  });

  it("still opens the link when the counter itself fails", async () => {
    repository.creditShareOpen.mockRejectedValue(new Error("throttled"));

    const response = await call(event("GET", "/shares/AB2CD3"));

    expect(response.statusCode).toBe(200);
  });

  it("404s an unknown or malformed token without reading anything", async () => {
    repository.getShare.mockResolvedValue(undefined);
    expect((await call(event("GET", "/shares/AB2CD3"))).statusCode).toBe(404);

    repository.getShare.mockClear();
    expect((await call(event("GET", "/shares/not-a-token"))).statusCode).toBe(
      404,
    );
    expect(repository.getShare).not.toHaveBeenCalled();
  });

  it("still opens after the player's profile is gone", async () => {
    repository.getPublicPlayer.mockResolvedValue(undefined);

    const response = await call(event("GET", "/shares/AB2CD3"));

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}").player).toBeUndefined();
  });
});
