import type { HttpRequest, HttpResponse } from "../src/http.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signToken } from "../src/signing.js";
const deleteAccount = vi.hoisted(() => vi.fn());
const getProfile = vi.hoisted(() => vi.fn());
const deletePlayerShareImages = vi.hoisted(() => vi.fn());
vi.mock("../src/repository.js", () => ({
  Repository: class {
    deleteAccount = deleteAccount;
    getProfile = getProfile;
  },
}));
vi.mock("../src/share-assets.js", () => ({ deletePlayerShareImages }));
import { dispatch } from "../src/app.js";
const secret = "test-session-secret";
function event(confirmation: string): HttpRequest {
  const nowSeconds = Math.floor(Date.now() / 1000);
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
    path: "/me",
    headers: {
      authorization: `Bearer ${session}`,
      "content-type": "application/json",
    },
    method: "DELETE",
    sourceIp: "127.0.0.1",
    requestId: "request-1",
    body: JSON.stringify({ confirmation }),
  };
}
describe("account deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TABLE_NAME = "test-table";
    process.env.SESSION_SECRET = secret;
    process.env.TELEMETRY_PEPPER = "test-telemetry-pepper";
    process.env.APP_URL = "https://drop.example";
    process.env.SHARE_ASSET_BUCKET = "share-assets";
    process.env.CR_REQUEST_QUEUE_URL = "https://sqs.example/requests";
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    getProfile.mockResolvedValue({
      sub: "player-sub",
      playerId: "player-1",
      email: "player@example.com",
      totalGames: 0,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    deletePlayerShareImages.mockResolvedValue(undefined);
  });
  it("requires an exact destructive-action confirmation", async () => {
    const response = (await dispatch(event("delete"))) as HttpResponse;
    expect(response.statusCode).toBe(400);
    expect(deleteAccount).not.toHaveBeenCalled();
  });
  it("deletes the authenticated player and returns no replacement session", async () => {
    deleteAccount.mockResolvedValue({ deletedGames: 42 });
    // The mailing list is Elixir's (2026-10-12): deleting a Drop profile makes
    // no outside call, so it unsubscribes nobody.
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("no outside call expected"));
    const response = (await dispatch(event("DELETE"))) as HttpResponse;
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body || "{}")).toEqual({ ok: true });
    expect(deleteAccount).toHaveBeenCalledWith("player-sub");
    expect(deletePlayerShareImages).toHaveBeenCalledWith(
      "share-assets",
      "player-1",
    );
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRestore();
  });
  it("stops a deleted account's session from renewing", async () => {
    getProfile.mockResolvedValue(undefined);
    const refresh = event("DELETE");
    refresh.path = "/auth/refresh";
    refresh.method = "POST";
    refresh.path = "/auth/refresh";
    refresh.body = "{}";
    const response = (await dispatch(refresh)) as HttpResponse;
    const body = JSON.parse(response.body || "{}");
    expect(response.statusCode).toBe(401);
    expect(body.error.code).toBe("invalid_session");
  });
});
