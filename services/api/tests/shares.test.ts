import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { playerReference, runReference } from "@elixir-drop/contracts";
import { signToken } from "../src/signing.js";
import { isShareToken, mintShareToken } from "../src/shares.js";

const repository = vi.hoisted(() => ({
  useRateLimit: vi.fn(),
  getRun: vi.fn(),
  getProfile: vi.fn(),
  getBadges: vi.fn(),
  putShare: vi.fn(),
  getShare: vi.fn(),
  getPublicPlayer: vi.fn(),
  getRecruiterInvite: vi.fn(),
  creditShareOpen: vi.fn(),
  listRunHistory: vi.fn(),
  refereeDecisions: vi.fn(),
  getPublishedRunShare: vi.fn(),
  getPublishedRunShareByTags: vi.fn(),
  refereeEvidenceForRuns: vi.fn(),
  setRunShareVisual: vi.fn(),
  putPublishedRunShare: vi.fn(),
  putPublishedRunShareAlias: vi.fn(),
  creditPublishedRunOpen: vi.fn(),
  addHeraldOpens: vi.fn(),
  getPublishedBadgeShare: vi.fn(),
  getPublishedBadgeShareByTag: vi.fn(),
  putPublishedBadgeShare: vi.fn(),
  getPublishedProfileShare: vi.fn(),
  getPublishedProfileShareByTag: vi.fn(),
  putPublishedProfileShare: vi.fn(),
  badgeDecisionRevision: vi.fn(),
  badgeXpKeys: vi.fn(),
}));

const shareAssets = vi.hoisted(() => ({
  put: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
  putBadge: vi.fn(),
  getBadge: vi.fn(),
  putProfile: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock("../src/repository.js", () => ({
  Repository: class {
    useRateLimit = repository.useRateLimit;
    getRun = repository.getRun;
    getProfile = repository.getProfile;
    getBadges = repository.getBadges;
    putShare = repository.putShare;
    getShare = repository.getShare;
    getPublicPlayer = repository.getPublicPlayer;
    getRecruiterInvite = repository.getRecruiterInvite;
    creditShareOpen = repository.creditShareOpen;
    listRunHistory = repository.listRunHistory;
    refereeDecisions = repository.refereeDecisions;
    getPublishedRunShare = repository.getPublishedRunShare;
    getPublishedRunShareByTags = repository.getPublishedRunShareByTags;
    refereeEvidenceForRuns = repository.refereeEvidenceForRuns;
    setRunShareVisual = repository.setRunShareVisual;
    putPublishedRunShare = repository.putPublishedRunShare;
    putPublishedRunShareAlias = repository.putPublishedRunShareAlias;
    creditPublishedRunOpen = repository.creditPublishedRunOpen;
    addHeraldOpens = repository.addHeraldOpens;
    getPublishedBadgeShare = repository.getPublishedBadgeShare;
    getPublishedBadgeShareByTag = repository.getPublishedBadgeShareByTag;
    putPublishedBadgeShare = repository.putPublishedBadgeShare;
    getPublishedProfileShare = repository.getPublishedProfileShare;
    getPublishedProfileShareByTag = repository.getPublishedProfileShareByTag;
    putPublishedProfileShare = repository.putPublishedProfileShare;
    badgeDecisionRevision = repository.badgeDecisionRevision;
    badgeXpKeys = repository.badgeXpKeys;
  },
}));

vi.mock("../src/share-assets.js", () => ({
  putRunShareImage: shareAssets.put,
  getRunShareImage: shareAssets.get,
  deleteRunShareImage: shareAssets.remove,
  putBadgeShareImage: shareAssets.putBadge,
  getBadgeShareImage: shareAssets.getBadge,
  putProfileShareImage: shareAssets.putProfile,
  getProfileShareImage: shareAssets.getProfile,
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

const playerId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const playerTag = playerReference(playerId).slice(1);
const runTag = runReference(runId).slice(1);
const publishedUrl = `https://drop.example/share/${playerTag}/${runTag}`;
const completedRun = {
  runId,
  mode: "surge" as const,
  score: 17_412,
  seasonId: 135,
  completedAt: "2026-08-19T12:00:20.000Z",
  shareVisual: {
    mode: "surge" as const,
    unit: "SECONDS PER CARD",
    values: [1_200, 900],
    bad: [false, true],
  },
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
});

describe("GET /share/{dropPlayerTag}/invite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.SHARE_ASSET_BUCKET = "share-assets";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.getRecruiterInvite.mockResolvedValue({
      sub: "player-sub",
      player: { id: playerId, publicName: "Drop King", totalGames: 40 },
    });
  });

  it("serves a generic invitation keyed only by the public Drop player tag", async () => {
    const response = await call(event("GET", `/share/${playerTag}/invite`));

    expect(response.statusCode).toBe(200);
    expect(repository.getRecruiterInvite).toHaveBeenCalledWith(playerTag);
    expect(response.body).toContain(
      `data-share-drop-player-tag="${playerTag}"`,
    );
    expect(response.body).toContain("/assets/share/invite-open.js");
    expect(response.body).not.toContain(playerId);
    expect(response.body).not.toContain("Drop King");
    expect(response.body).not.toContain("View profile");
  });

  it("supports HEAD and rejects unknown or malformed Drop player tags", async () => {
    const head = await call(event("HEAD", `/share/${playerTag}/invite`));
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe("");

    repository.getRecruiterInvite.mockResolvedValue(undefined);
    expect(
      (await call(event("GET", `/share/${playerTag}/invite`))).statusCode,
    ).toBe(404);

    repository.getRecruiterInvite.mockClear();
    expect(
      (await call(event("GET", "/share/raw-uuid/invite"))).statusCode,
    ).toBe(404);
    expect(repository.getRecruiterInvite).not.toHaveBeenCalled();
  });
});

describe("POST /runs/{runId}/share", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.SHARE_ASSET_BUCKET = "share-assets";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.getProfile.mockResolvedValue({
      sub: "player-sub",
      playerId,
      publicName: "Drop King",
      totalGames: 40,
      xp: 900,
    });
    repository.listRunHistory.mockResolvedValue([completedRun]);
    repository.refereeDecisions.mockResolvedValue(new Map());
    repository.getPublishedRunShare.mockResolvedValue(undefined);
    repository.putPublishedRunShare.mockResolvedValue(true);
    repository.putPublishedRunShareAlias.mockResolvedValue(undefined);
    shareAssets.put.mockResolvedValue(undefined);
  });

  it("publishes one clean deterministic link from durable run history", async () => {
    const response = await call(
      event("POST", `/runs/${runId}/share`, {
        sub: "player-sub",
        body: { completedAt: completedRun.completedAt },
      }),
    );

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body ?? "{}")).toEqual({
      playerId,
      runId,
      url: publishedUrl,
      preview: {
        mode: "surge",
        score: "17.412s",
        playerName: "Drop King",
        visual: completedRun.shareVisual,
      },
    });
    const stored = repository.putPublishedRunShare.mock.calls[0]![0];
    expect(stored).toMatchObject({
      kind: "published-run",
      owner: "player-sub",
      playerId,
      runId,
      score: 17_412,
      player: { publicName: "Drop King" },
    });
    expect(JSON.stringify(stored)).not.toContain("transcript");
    expect(stored).toMatchObject({ playerTag, runTag });
    expect(shareAssets.put).not.toHaveBeenCalled();
  });

  it("returns the same link without regenerating an already-published run", async () => {
    repository.getPublishedRunShare.mockResolvedValue({
      kind: "published-run",
      playerId,
      runId,
      owner: "player-sub",
      mode: "surge",
      score: 17_412,
      player: { publicName: "Drop King" },
    });
    const response = await call(
      event("POST", `/runs/${runId}/share`, { sub: "player-sub" }),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}").url).toBe(publishedUrl);
    expect(shareAssets.put).not.toHaveBeenCalled();
    expect(repository.putPublishedRunShare).not.toHaveBeenCalled();
    expect(repository.putPublishedRunShareAlias).toHaveBeenCalled();
  });

  it("refuses a run excluded from public competition", async () => {
    repository.refereeDecisions.mockResolvedValue(
      new Map([
        [
          runId,
          {
            runId,
            decidedBy: "fair-play-referee",
            visibility: "hidden",
            disposition: "review",
          },
        ],
      ]),
    );
    const response = await call(
      event("POST", `/runs/${runId}/share`, { sub: "player-sub" }),
    );
    expect(response.statusCode).toBe(409);
    expect(shareAssets.put).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    const response = await call(event("POST", `/runs/${runId}/share`));
    expect(response.statusCode).toBe(401);
  });
});

describe("published run link", () => {
  const published = {
    pk: `SHARE#RUN#${playerId}#${runId}`,
    sk: "SHARE" as const,
    kind: "published-run" as const,
    owner: "player-sub",
    playerId,
    runId,
    playerTag,
    runTag,
    mode: "surge" as const,
    score: 17_412,
    seasonId: 135,
    completedAt: completedRun.completedAt,
    publishedAt: "2026-08-23T06:00:00.000Z",
    player: {
      id: playerId,
      publicName: "Drop King",
      totalGames: 40,
      xp: 900,
    },
    visual: completedRun.shareVisual,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.SHARE_ASSET_BUCKET = "share-assets";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.getPublishedRunShare.mockResolvedValue(published);
    repository.getPublishedRunShareByTags.mockResolvedValue(published);
    repository.refereeDecisions.mockResolvedValue(new Map());
    repository.creditPublishedRunOpen.mockResolvedValue(true);
    shareAssets.get.mockResolvedValue(Buffer.from("png"));
    shareAssets.remove.mockResolvedValue(undefined);
  });

  it("serves a clean unfurl page without counting crawler fetches", async () => {
    const response = await call(event("GET", `/share/${playerTag}/${runTag}`));

    expect(response.statusCode).toBe(200);
    expect(response.headers?.["content-type"]).toContain("text/html");
    expect(response.body).toContain(
      `property="og:image" content="https://drop.example/share-assets/${playerTag}/${runTag}"`,
    );
    const alt =
      "Drop King scored 17.412s in Surge. The run chart shows 2 results in seconds per card. 1 result is marked as costly.";
    expect(response.body).toContain(`property="og:image:alt" content="${alt}"`);
    expect(response.body).toContain(
      `name="twitter:image:alt" content="${alt}"`,
    );
    expect(response.body).toContain(`alt="${alt}"`);
    expect(response.headers?.["content-security-policy"]).toContain(
      "font-src 'self'",
    );
    expect(response.body).toContain("BEAT 17.412s");
    expect(response.body).toContain("Free · no account needed");
    expect(repository.creditPublishedRunOpen).not.toHaveBeenCalled();
  });

  it("serves the permanent PNG without counting an unfurl image fetch", async () => {
    const response = await call(
      event("GET", `/share-assets/${playerTag}/${runTag}`),
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers?.["content-type"]).toBe("image/png");
    expect(response.isBase64Encoded).toBe(true);
    expect(repository.creditPublishedRunOpen).not.toHaveBeenCalled();
  });

  it("credits only the explicit browser-open callback and dedupes in the repository", async () => {
    const response = await call(
      event("POST", `/share/${playerTag}/${runTag}/open`, {
        ip: "8.8.8.8",
        userAgent: "Safari",
      }),
    );

    expect(response.statusCode).toBe(204);
    expect(repository.creditPublishedRunOpen).toHaveBeenCalledWith(
      playerId,
      runId,
      expect.not.stringContaining("8.8.8.8"),
      25,
    );
    expect(repository.addHeraldOpens).toHaveBeenCalledWith("player-sub", 1);
  });

  it("does not credit the owner opening their own run", async () => {
    const response = await call(
      event("POST", `/share/${playerTag}/${runTag}/open`, {
        sub: "player-sub",
      }),
    );

    expect(response.statusCode).toBe(204);
    expect(repository.creditPublishedRunOpen).not.toHaveBeenCalled();
    expect(repository.addHeraldOpens).not.toHaveBeenCalled();
  });

  it("fails closed and removes the image when a referee excludes the run", async () => {
    repository.refereeDecisions.mockResolvedValue(
      new Map([
        [
          runId,
          {
            runId,
            decidedBy: "fair-play-referee",
            visibility: "hidden",
            disposition: "review",
          },
        ],
      ]),
    );

    const response = await call(event("GET", `/share/${playerTag}/${runTag}`));

    expect(response.statusCode).toBe(404);
    expect(shareAssets.remove).toHaveBeenCalledWith(
      "share-assets",
      playerId,
      runId,
    );
  });

  it("keeps an old UUID address readable while making the tag address canonical", async () => {
    const response = await call(event("GET", `/share/${playerId}/${runId}`));

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(
      `<link rel="canonical" href="${publishedUrl}">`,
    );
  });

  it("redirects a missing v2 preview to the polished generic PNG", async () => {
    shareAssets.get.mockResolvedValue(undefined);
    const response = await call(
      event("GET", `/share-assets/${playerTag}/${runTag}`),
    );

    expect(response.statusCode).toBe(302);
    expect(response.headers?.location).toBe(
      "https://drop.example/assets/og-image.png",
    );
  });
});

function previewPng(width = 1_200, height = 630): Buffer {
  const png = Buffer.alloc(64);
  Buffer.from("89504e470d0a1a0a", "hex").copy(png, 0);
  png.writeUInt32BE(13, 8);
  png.write("IHDR", 12, "ascii");
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return png;
}

describe("published badge link", () => {
  const slug = "clockbreaker";
  const rungIndex = 3;
  const badgeUrl = `https://drop.example/share/${playerTag}/badge/${slug}/4`;
  const publishedBadge = {
    pk: `SHARE#BADGE#${playerId}#${slug}#${rungIndex}`,
    sk: "SHARE" as const,
    kind: "published-badge" as const,
    owner: "player-sub",
    playerId,
    playerTag,
    slug,
    rungIndex,
    publishedAt: "2026-08-23T06:00:00.000Z",
    player: {
      id: playerId,
      publicName: "Drop King",
      favoriteCardId: 26000000,
      totalGames: 40,
      xp: 900,
    },
    badge: {
      name: "Clockbreaker",
      tier: "copper" as const,
      chip: "35s",
      milestone: 35,
      rungCount: 12,
      earnedAt: "2026-08-19T12:00:00.000Z",
      requirement: "Fastest Surge run",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.SHARE_ASSET_BUCKET = "share-assets";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.getProfile.mockResolvedValue({
      sub: "player-sub",
      playerId,
      publicName: "Drop King",
      favoriteCardId: 26000000,
      totalGames: 40,
      xp: 900,
    });
    repository.getBadges.mockResolvedValue({
      version: 9,
      values: { clockbreaker: 34.2 },
      runsAtRung: { clockbreaker: [12, 9, 5, 2] },
      aux: { modes: [], cards: [], playedDays: [], dayRuns: 0 },
      earned: {
        clockbreaker: [
          "2026-08-10T12:00:00.000Z",
          "2026-08-12T12:00:00.000Z",
          "2026-08-15T12:00:00.000Z",
          "2026-08-19T12:00:00.000Z",
        ],
      },
    });
    repository.getPublishedBadgeShare.mockResolvedValue(undefined);
    repository.putPublishedBadgeShare.mockResolvedValue(true);
    repository.getPublishedBadgeShareByTag.mockResolvedValue(publishedBadge);
    shareAssets.putBadge.mockResolvedValue(undefined);
    shareAssets.getBadge.mockResolvedValue(Buffer.from("png"));
  });

  it("freezes an earned rung at its permanent player-tag address", async () => {
    const response = await call(
      event("POST", `/badges/${slug}/share`, {
        sub: "player-sub",
        body: { rungIndex },
      }),
    );

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body ?? "{}")).toMatchObject({
      playerId,
      slug,
      rungIndex,
      url: badgeUrl,
      preview: {
        playerName: "Drop King",
        favoriteCardId: 26000000,
        name: "Clockbreaker",
        tier: "copper",
        chip: "35s",
        rungIndex,
        rungCount: 12,
        requirement: "Fastest Surge run",
      },
    });
    expect(repository.putPublishedBadgeShare).toHaveBeenCalledWith(
      expect.objectContaining({
        playerId,
        playerTag,
        slug,
        rungIndex,
        badge: expect.objectContaining({ chip: "35s", tier: "copper" }),
      }),
    );
  });

  it("does not publish a rung the player has not earned", async () => {
    const response = await call(
      event("POST", `/badges/${slug}/share`, {
        sub: "player-sub",
        body: { rungIndex: 4 },
      }),
    );

    expect(response.statusCode).toBe(404);
    expect(repository.putPublishedBadgeShare).not.toHaveBeenCalled();
  });

  it("accepts the owner's exact 1200 by 630 PNG", async () => {
    const image = previewPng();
    repository.getPublishedBadgeShare.mockResolvedValue(publishedBadge);

    const response = await call(
      event("PUT", `/badges/${slug}/share`, {
        sub: "player-sub",
        body: { rungIndex, image: image.toString("base64") },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(shareAssets.putBadge).toHaveBeenCalledWith(
      "share-assets",
      playerId,
      slug,
      rungIndex,
      image,
    );
  });

  it("serves complete unfurl metadata and visible image alt text", async () => {
    const response = await call(
      event("GET", `/share/${playerTag}/badge/${slug}/4`),
    );
    const alt =
      "Drop King earned the Clockbreaker badge at the 35s milestone, rung 4 of 12. The milestone recognizes fastest surge run.";

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(
      `<link rel="canonical" href="${badgeUrl}">`,
    );
    expect(response.body).toContain(
      `property="og:image" content="https://drop.example/share-assets/${playerTag}/badge/${slug}/4"`,
    );
    expect(response.body).toContain(`property="og:image:alt" content="${alt}"`);
    expect(response.body).toContain(
      `name="twitter:image:alt" content="${alt}"`,
    );
    expect(response.body).toContain(`alt="${alt}"`);
    expect(response.body).toContain("EARN YOURS");
    expect(response.body).toContain("/assets/share/badge-open.js");
  });

  it("uses neutral play copy when an earned-only community badge is shared", async () => {
    repository.getPublishedBadgeShareByTag.mockResolvedValueOnce({
      ...publishedBadge,
      pk: `SHARE#BADGE#${playerId}#first-drop#0`,
      slug: "first-drop",
      rungIndex: 0,
      badge: {
        name: "First Drop",
        tier: "prismatic",
        chip: "100",
        milestone: 100,
        rungCount: 1,
        earnedAt: "2026-08-25T12:00:00.000Z",
        requirement: "Be one of the first 100 registered Elixir Drop players",
      },
    });

    const response = await call(
      event("GET", `/share/${playerTag}/badge/first-drop/1`),
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("PLAY ELIXIR DROP");
    expect(response.body).toContain("limited First Drop community badge");
    expect(response.body).not.toContain("EARN YOURS");
  });

  it("serves the retained PNG and redirects a missing one to the default", async () => {
    const path = `/share-assets/${playerTag}/badge/${slug}/4`;
    const response = await call(event("GET", path));
    expect(response.statusCode).toBe(200);
    expect(response.headers?.["content-type"]).toBe("image/png");
    expect(response.isBase64Encoded).toBe(true);
    expect(shareAssets.getBadge).toHaveBeenCalledWith(
      "share-assets",
      playerId,
      slug,
      rungIndex,
    );

    shareAssets.getBadge.mockResolvedValue(undefined);
    const missing = await call(event("GET", path));
    expect(missing.statusCode).toBe(302);
    expect(missing.headers?.location).toBe(
      "https://drop.example/assets/og-image.png",
    );
  });
});

describe("published profile link", () => {
  const profileUrl = `https://drop.example/share/${playerTag}`;
  const publishedProfile = {
    pk: `SHARE#PROFILE#${playerId}`,
    sk: "SHARE" as const,
    kind: "published-profile" as const,
    owner: "player-sub",
    playerId,
    playerTag,
    publishedAt: "2026-08-23T06:00:00.000Z",
    player: {
      id: playerId,
      publicName: "Drop King",
      favoriteCardId: 26000000,
      totalGames: 40,
      xp: 900,
    },
    arena: 8,
    badgeCount: 1,
    badges: [
      {
        slug: "clockbreaker",
        name: "Clockbreaker",
        tier: "copper" as const,
        chip: "35s",
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.SHARE_ASSET_BUCKET = "share-assets";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.getProfile.mockResolvedValue({
      sub: "player-sub",
      playerId,
      publicName: "Drop King",
      favoriteCardId: 26000000,
      totalGames: 40,
      xp: 900,
    });
    repository.getBadges.mockResolvedValue({
      version: 9,
      refereeReconciled: true,
      values: { clockbreaker: 34, "arena-climber": 8 },
      runsAtRung: {},
      aux: { modes: [], cards: [], playedDays: [], dayRuns: 0 },
      earned: {},
    });
    repository.badgeDecisionRevision.mockResolvedValue(undefined);
    repository.badgeXpKeys.mockResolvedValue(new Set());
    repository.putPublishedProfileShare.mockResolvedValue(undefined);
    repository.getPublishedProfileShare.mockResolvedValue(publishedProfile);
    repository.getPublishedProfileShareByTag.mockResolvedValue(
      publishedProfile,
    );
    shareAssets.putProfile.mockResolvedValue(undefined);
    shareAssets.getProfile.mockResolvedValue(Buffer.from("png"));
  });

  it("refreshes the owner's current profile at one permanent player-tag URL", async () => {
    const response = await call(
      event("POST", "/me/share", { sub: "player-sub" }),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toMatchObject({
      playerId,
      url: profileUrl,
      preview: {
        playerName: "Drop King",
        favoriteCardId: 26000000,
        xp: 900,
        arena: 7,
        badgeCount: expect.any(Number),
      },
    });
    expect(repository.putPublishedProfileShare).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "published-profile",
        playerId,
        playerTag,
        arena: 7,
      }),
    );
  });

  it("accepts only the owner's exact 1200 by 630 profile PNG", async () => {
    const image = previewPng();
    const response = await call(
      event("PUT", "/me/share", {
        sub: "player-sub",
        body: { image: image.toString("base64") },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(shareAssets.putProfile).toHaveBeenCalledWith(
      "share-assets",
      playerId,
      image,
    );
  });

  it("serves complete profile unfurl metadata and visible alt text", async () => {
    const response = await call(event("GET", `/share/${playerTag}`));
    const alt =
      "Elixir Drop profile for Drop King: Arena 8, 900 Player XP, and 1 earned badge. Highlights include Clockbreaker.";

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(
      `<link rel="canonical" href="${profileUrl}">`,
    );
    expect(response.body).toContain(
      `property="og:image" content="https://drop.example/share-assets/${playerTag}"`,
    );
    expect(response.body).toContain(`property="og:image:alt" content="${alt}"`);
    expect(response.body).toContain(
      `name="twitter:image:alt" content="${alt}"`,
    );
    expect(response.body).toContain(`alt="${alt}"`);
    expect(response.body).toContain("PLAY ELIXIR DROP");
    expect(response.body).toContain("/assets/share/profile-open.js");
  });

  it("serves the profile PNG and falls back to the current generic card", async () => {
    const path = `/share-assets/${playerTag}`;
    const response = await call(event("GET", path));
    expect(response.statusCode).toBe(200);
    expect(shareAssets.getProfile).toHaveBeenCalledWith(
      "share-assets",
      playerId,
    );

    shareAssets.getProfile.mockResolvedValue(undefined);
    const missing = await call(event("GET", path));
    expect(missing.statusCode).toBe(302);
    expect(missing.headers?.location).toBe(
      "https://drop.example/assets/og-image.png",
    );
  });
});

describe("PUT /runs/{runId}/share", () => {
  const published = {
    pk: `SHARE#RUN#${playerId}#${runId}`,
    sk: "SHARE" as const,
    kind: "published-run" as const,
    owner: "player-sub",
    playerId,
    runId,
    playerTag,
    runTag,
    mode: "surge" as const,
    score: 17_412,
    seasonId: 135,
    completedAt: completedRun.completedAt,
    publishedAt: "2026-08-23T06:00:00.000Z",
    player: { id: playerId, publicName: "Drop King", totalGames: 40, xp: 900 },
    visual: completedRun.shareVisual,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.SHARE_ASSET_BUCKET = "share-assets";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.getProfile.mockResolvedValue({
      sub: "player-sub",
      playerId,
      publicName: "Drop King",
    });
    repository.getPublishedRunShare.mockResolvedValue(published);
    repository.refereeDecisions.mockResolvedValue(new Map());
    repository.useRateLimit.mockResolvedValue(undefined);
    shareAssets.put.mockResolvedValue(undefined);
  });

  it("accepts only the owner's 1200 by 630 PNG", async () => {
    const image = previewPng();
    const response = await call(
      event("PUT", `/runs/${runId}/share`, {
        sub: "player-sub",
        body: {
          completedAt: completedRun.completedAt,
          image: image.toString("base64"),
        },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toEqual({ ok: true });
    expect(shareAssets.put).toHaveBeenCalledWith(
      "share-assets",
      playerId,
      runId,
      image,
    );
  });

  it("rejects a PNG with the wrong dimensions", async () => {
    const response = await call(
      event("PUT", `/runs/${runId}/share`, {
        sub: "player-sub",
        body: { image: previewPng(1080, 1350).toString("base64") },
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(shareAssets.put).not.toHaveBeenCalled();
  });

  it("does not accept an upload from another account", async () => {
    const response = await call(
      event("PUT", `/runs/${runId}/share`, {
        sub: "other-player",
        body: { image: previewPng().toString("base64") },
      }),
    );

    expect(response.statusCode).toBe(404);
    expect(shareAssets.put).not.toHaveBeenCalled();
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
    seasonId: 135,
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
