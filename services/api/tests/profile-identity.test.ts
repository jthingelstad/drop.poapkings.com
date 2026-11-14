import type { HttpRequest, HttpResponse } from "../src/http.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signToken } from "../src/signing.js";
const repository = vi.hoisted(() => ({
  getCrProfile: vi.fn(),
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  useRateLimit: vi.fn(),
  rankedAccess: vi.fn(async () => "allowed" as const),
}));
vi.mock("../src/repository.js", () => ({
  Repository: class {
    getCrProfile = repository.getCrProfile;
    getProfile = repository.getProfile;
    updateProfile = repository.updateProfile;
    useRateLimit = repository.useRateLimit;
    rankedAccess = repository.rankedAccess;
  },
}));
import { dispatch } from "../src/app.js";
const secret = "test-session-secret";
const nowSeconds = Math.floor(Date.now() / 1000);
const FAVORITE_CARD_ID = 26000018;
const profile = {
  sub: "player-sub",
  playerId: "11111111-1111-4111-8111-111111111111",
  email: "player@example.com",
  publicName: "Knight Main",
  favoriteCardId: FAVORITE_CARD_ID,
  totalGames: 4,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-18T12:00:00.000Z",
};
function session(sub = profile.sub) {
  return signToken(
    { type: "session", sub, iat: nowSeconds - 60, exp: nowSeconds + 3600 },
    secret,
  );
}
async function invoke(
  method: string,
  path: string,
  body: Record<string, unknown>,
) {
  const event = {
    path,
    headers: {
      authorization: `Bearer ${session()}`,
      "content-type": "application/json",
    },
    method,
    sourceIp: "127.0.0.1",
    requestId: "request-identity",
    body: JSON.stringify(body),
  } as HttpRequest;
  const response = (await dispatch(event)) as HttpResponse;
  return {
    statusCode: response.statusCode,
    body: JSON.parse(response.body || "{}") as {
      error?: {
        code?: string;
        message?: string;
      };
    },
  };
}
// The name and picture are not Drop's to set (2026-11-14): they come from the
// person's Elixir account at sign-in. PATCH /me refuses every way a client
// could still try to set them, and the name generator's route is gone.
describe("player identity comes from Elixir", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    repository.useRateLimit.mockResolvedValue(undefined);
    repository.getProfile.mockResolvedValue(profile);
    repository.updateProfile.mockResolvedValue(profile);
    repository.getCrProfile.mockResolvedValue(undefined);
  });
  it.each([
    { publicName: "Pancake Patrol" },
    { favoriteCardId: FAVORITE_CARD_ID },
    { nameToken: "anything" },
    {
      favoriteCardId: FAVORITE_CARD_ID,
      publicName: "Pancake Patrol",
      nameToken: "anything",
    },
  ])("refuses a client setting its own name or picture: %o", async (body) => {
    const result = await invoke("PATCH", "/me", body);
    expect(result.statusCode).toBe(400);
    expect(result.body.error?.code).toBe("identity_from_elixir");
    expect(repository.updateProfile).not.toHaveBeenCalled();
  });
  it("refuses a player tag, even a mistyped or emptied one, and writes nothing", async () => {
    for (const playerTag of ["not a tag!", "", "#20JJJ2CCRU"]) {
      const result = await invoke("PATCH", "/me", { playerTag });
      expect(result.statusCode).toBe(400);
      expect(result.body.error?.code).toBe("player_from_elixir");
    }
    // Even beside a field that is allowed: nothing is half-applied.
    const mixed = await invoke("PATCH", "/me", {
      playerTag: "",
      lastOpenedUpdates: "2026-11-14T00:00:00.000Z",
    });
    expect(mixed.statusCode).toBe(400);
    expect(repository.updateProfile).not.toHaveBeenCalled();
  });
  it("still stamps the Updates read time", async () => {
    const result = await invoke("PATCH", "/me", {
      lastOpenedUpdates: "2026-11-14T00:00:00.000Z",
    });
    expect(result.statusCode).toBe(200);
    expect(repository.updateProfile).toHaveBeenCalledWith(profile.sub, {
      lastOpenedUpdates: expect.any(String),
    });
  });
  it("rejects a PATCH that changes nothing", async () => {
    const result = await invoke("PATCH", "/me", { nickname: "ignored" });
    expect(result.statusCode).toBe(400);
    expect(repository.updateProfile).not.toHaveBeenCalled();
  });
  it("the name generator's route is gone", async () => {
    const result = await invoke("POST", "/me/name-options", {
      favoriteCardId: FAVORITE_CARD_ID,
    });
    expect(result.statusCode).toBe(404);
    expect(repository.useRateLimit).not.toHaveBeenCalled();
  });
  it("rejects a malformed request body before any work happens", async () => {
    const event = {
      path: "/me",
      headers: { authorization: `Bearer ${session()}` },
      method: "PATCH",
      sourceIp: "127.0.0.1",
      requestId: "request-identity",
      body: "[]",
    } as HttpRequest;
    const response = (await dispatch(event)) as HttpResponse;
    expect(response.statusCode).toBe(400);
    expect(repository.updateProfile).not.toHaveBeenCalled();
  });
});
