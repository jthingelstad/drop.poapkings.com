import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signToken } from "../src/signing.js";

const repository = vi.hoisted(() => ({
  getCrProfile: vi.fn(),
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  useRateLimit: vi.fn(),
}));
const generateNameOptions = vi.hoisted(() => vi.fn());

vi.mock("../src/repository.js", () => ({
  Repository: class {
    getCrProfile = repository.getCrProfile;
    getProfile = repository.getProfile;
    updateProfile = repository.updateProfile;
    useRateLimit = repository.useRateLimit;
  },
}));

vi.mock("../src/names.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/names.js")>();
  return { ...actual, generateNameOptions };
});

vi.mock("../src/cr-refresh.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/cr-refresh.js")>();
  return { ...actual, requestCrProfileRefresh: vi.fn() };
});

import { handler } from "../src/handler.js";

const secret = "test-session-secret";
const nowSeconds = Math.floor(Date.now() / 1_000);
const FAVORITE_CARD_ID = 26000018;
const profile = {
  sub: "player-sub",
  playerId: "player-1",
  email: "player@example.com",
  publicName: "Knight Main",
  favoriteCardId: FAVORITE_CARD_ID,
  totalGames: 4,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-18T12:00:00.000Z",
};

function session(sub = profile.sub) {
  return signToken(
    { type: "session", sub, iat: nowSeconds - 60, exp: nowSeconds + 3_600 },
    secret,
  );
}

function nameToken(overrides: Record<string, unknown> = {}) {
  return signToken(
    {
      type: "names",
      sub: profile.sub,
      favoriteCardId: FAVORITE_CARD_ID,
      names: ["Pancake Patrol", "Mini P Griddle"],
      iat: nowSeconds - 60,
      exp: nowSeconds + 900,
      ...overrides,
    } as never,
    secret,
  );
}

async function invoke(
  method: string,
  path: string,
  body: Record<string, unknown>,
) {
  const event = {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers: {
      authorization: `Bearer ${session()}`,
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
      requestId: "request-identity",
      routeKey: "$default",
      stage: "$default",
      time: "18/Jul/2026:12:05:00 +0000",
      timeEpoch: nowSeconds * 1_000,
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
  const response = (await handler(
    event,
    {} as Context,
    vi.fn(),
  )) as APIGatewayProxyStructuredResultV2;
  return {
    statusCode: response.statusCode,
    body: JSON.parse(response.body || "{}") as {
      error?: { code?: string; message?: string };
      names?: string[];
    },
  };
}

// A public name is not free text: it is bound by a signed token to one player
// and one card, and the API is the only thing enforcing that. Each of these is
// a way a caller could try to slip a name past the binding.
describe("player identity binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.FASTMAIL_JMAP_TOKEN = "test-jmap-token";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.getProfile.mockResolvedValue(profile);
    repository.updateProfile.mockResolvedValue(profile);
    repository.getCrProfile.mockResolvedValue(undefined);
  });

  it("refuses a name token minted for another player", async () => {
    const result = await invoke("PATCH", "/me", {
      favoriteCardId: FAVORITE_CARD_ID,
      publicName: "Pancake Patrol",
      nameToken: nameToken({ sub: "someone-else" }),
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error?.code).toBe("invalid_player_identity");
    expect(repository.updateProfile).not.toHaveBeenCalled();
  });

  it("refuses a name token issued against a different card", async () => {
    const result = await invoke("PATCH", "/me", {
      favoriteCardId: FAVORITE_CARD_ID,
      publicName: "Pancake Patrol",
      nameToken: nameToken({ favoriteCardId: 26000000 }),
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error?.code).toBe("invalid_player_identity");
    expect(repository.updateProfile).not.toHaveBeenCalled();
  });

  it("refuses a name that was never one of the offered options", async () => {
    const result = await invoke("PATCH", "/me", {
      favoriteCardId: FAVORITE_CARD_ID,
      publicName: "Definitely Not Offered",
      nameToken: nameToken(),
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error?.code).toBe("invalid_player_identity");
    expect(repository.updateProfile).not.toHaveBeenCalled();
  });

  it("asks the player to choose again when the options token is unreadable", async () => {
    const result = await invoke("PATCH", "/me", {
      favoriteCardId: FAVORITE_CARD_ID,
      publicName: "Pancake Patrol",
      nameToken: "not-a-real-token",
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error?.code).toBe("expired_name_options");
  });

  it("refuses an identity change with no signed token at all", async () => {
    const result = await invoke("PATCH", "/me", {
      favoriteCardId: FAVORITE_CARD_ID,
      publicName: "Pancake Patrol",
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error?.code).toBe("invalid_player_identity");
  });

  it("refuses a favorite card that is not in the canonical catalog", async () => {
    const result = await invoke("PATCH", "/me", {
      favoriteCardId: 1,
      publicName: "Pancake Patrol",
      nameToken: nameToken(),
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error?.code).toBe("invalid_player_identity");
  });

  it("answers a mistyped player tag with the validation message", async () => {
    const result = await invoke("PATCH", "/me", { playerTag: "not a tag!" });

    expect(result.statusCode).toBe(400);
    expect(result.body.error?.message).toBe(
      "Enter a valid Clash Royale player tag",
    );
    expect(repository.updateProfile).not.toHaveBeenCalled();
  });

  it("treats an emptied tag as an explicit unlink", async () => {
    const result = await invoke("PATCH", "/me", { playerTag: "" });

    expect(result.statusCode).toBe(200);
    expect(repository.updateProfile).toHaveBeenCalledWith(profile.sub, {
      clearPlayerTag: true,
    });
  });

  it("rejects a PATCH that changes nothing", async () => {
    const result = await invoke("PATCH", "/me", { nickname: "ignored" });

    expect(result.statusCode).toBe(400);
    expect(repository.updateProfile).not.toHaveBeenCalled();
  });

  it("will not mint name options for a card that does not exist", async () => {
    const result = await invoke("POST", "/me/name-options", {
      favoriteCardId: 999,
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error?.code).toBe("invalid_favorite_card");
    expect(generateNameOptions).not.toHaveBeenCalled();
  });

  it("mints card-bound options behind the per-player rate limit", async () => {
    generateNameOptions.mockResolvedValue(["Pancake Patrol", "Mini P Griddle"]);

    const result = await invoke("POST", "/me/name-options", {
      favoriteCardId: FAVORITE_CARD_ID,
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.names).toEqual(["Pancake Patrol", "Mini P Griddle"]);
    expect(repository.useRateLimit).toHaveBeenCalledWith(
      "names",
      profile.sub,
      10,
      60 * 60,
    );
  });

  it("rejects a malformed request body before any work happens", async () => {
    const event = {
      version: "2.0",
      routeKey: "$default",
      rawPath: "/me",
      rawQueryString: "",
      headers: { authorization: `Bearer ${session()}` },
      requestContext: {
        accountId: "test",
        apiId: "test",
        domainName: "test.example",
        domainPrefix: "test",
        http: {
          method: "PATCH",
          path: "/me",
          protocol: "HTTP/1.1",
          sourceIp: "127.0.0.1",
          userAgent: "vitest",
        },
        requestId: "request-identity",
        routeKey: "$default",
        stage: "$default",
        time: "18/Jul/2026:12:05:00 +0000",
        timeEpoch: nowSeconds * 1_000,
      },
      body: "[]",
      isBase64Encoded: false,
    } as APIGatewayProxyEventV2;

    const response = (await handler(
      event,
      {} as Context,
      vi.fn(),
    )) as APIGatewayProxyStructuredResultV2;

    expect(response.statusCode).toBe(400);
    expect(repository.updateProfile).not.toHaveBeenCalled();
  });
});
