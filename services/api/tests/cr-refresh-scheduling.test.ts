import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signToken } from "../src/signing.js";

const repository = vi.hoisted(() => ({
  consumeMagicLink: vi.fn(),
  ensureProfile: vi.fn(),
  getCrProfile: vi.fn(),
  getProfile: vi.fn(),
  listRecentRuns: vi.fn(),
  updateProfile: vi.fn(),
}));
const requestCrProfileRefresh = vi.hoisted(() => vi.fn());

vi.mock("../src/repository.js", () => ({
  Repository: class {
    consumeMagicLink = repository.consumeMagicLink;
    ensureProfile = repository.ensureProfile;
    getCrProfile = repository.getCrProfile;
    getProfile = repository.getProfile;
    listRecentRuns = repository.listRecentRuns;
    updateProfile = repository.updateProfile;
  },
}));

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
    process.env.APP_URL = "https://drop.example";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.getCrProfile.mockResolvedValue(snapshot);
    requestCrProfileRefresh.mockResolvedValue(snapshot);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  it("refreshes an attached tag after a successful magic-link login", async () => {
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
});
