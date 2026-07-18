import { describe, expect, it, vi } from "vitest";
import {
  completedGameWebhookPayload,
  loginWebhookPayload,
  publishDiscordEvent,
} from "../src/discord.js";
import type { PlayerProfile } from "../src/types.js";

const profile: PlayerProfile = {
  sub: "email-subject",
  playerId: "player-123",
  email: "player@example.com",
  publicName: "Inferno Dragon Main",
  favoriteCardId: 26000037,
  playerTag: "#2PYQ0",
  totalGames: 14,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-18T12:00:00.000Z",
};

function fieldValue(
  payload: ReturnType<typeof loginWebhookPayload>,
  name: string,
): string | undefined {
  return payload.embeds[0]?.fields.find((field) => field.name === name)?.value;
}

describe("Discord event notifications", () => {
  it("builds login events from useful profile metadata", () => {
    const payload = loginWebhookPayload({
      profile,
      newPlayer: false,
      occurredAt: "2026-07-18T12:00:00.000Z",
      requestId: "request-123",
      userAgent: "Drop Browser",
    });

    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.embeds[0]?.title).toBe("Player Login");
    expect(fieldValue(payload, "Login Type")).toBe("Returning player");
    expect(fieldValue(payload, "Email")).toBe("player@example.com");
    expect(fieldValue(payload, "Favorite Card")).toBe("Inferno Dragon");
    expect(fieldValue(payload, "Progress")).toBe("14 games · Level 2");
    expect(fieldValue(payload, "Client")).toBe("Drop Browser");
    expect(JSON.stringify(payload)).not.toContain("email-subject");
  });

  it("formats authenticated and anonymous completed games", () => {
    const authenticated = completedGameWebhookPayload({
      authenticated: true,
      runId: "run-123",
      mode: "surge",
      score: 12_345,
      seasonId: "2026-07",
      completedAt: "2026-07-18T12:01:00.000Z",
      profile,
    });
    expect(authenticated.embeds[0]?.title).toBe("Game Finished");
    expect(fieldValue(authenticated, "Mode")).toBe("Surge");
    expect(fieldValue(authenticated, "Score")).toBe("12.345 seconds");
    expect(fieldValue(authenticated, "Authenticated")).toBe("Yes");
    expect(fieldValue(authenticated, "Run ID")).toBe("run-123");

    const anonymous = completedGameWebhookPayload({
      authenticated: false,
      runId: "run-anon",
      mode: "practice",
      score: 87,
      seasonId: "2026-07",
      completedAt: "2026-07-18T12:02:00.000Z",
    });
    expect(fieldValue(anonymous, "Player")).toBe("Anonymous");
    expect(fieldValue(anonymous, "Score")).toBe("87%");
  });

  it("posts JSON without allowing notification failures to escape", async () => {
    const payload = loginWebhookPayload({
      profile,
      newPlayer: true,
      occurredAt: "2026-07-18T12:00:00.000Z",
      requestId: "request-123",
    });
    const fetcher = vi.fn(async (_input: string, _init: RequestInit) => ({
      ok: true,
      status: 204,
    }));
    await publishDiscordEvent(
      "https://discord.example/webhook",
      payload,
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://discord.example/webhook");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(payload);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      publishDiscordEvent(
        "https://discord.example/webhook",
        payload,
        async () => ({ ok: false, status: 429 }),
      ),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "Discord event delivery failed with HTTP 429.",
    );
    warn.mockRestore();
  });

  it("is disabled when no webhook is configured", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 204 }));
    await publishDiscordEvent(
      undefined,
      completedGameWebhookPayload({
        authenticated: false,
        runId: "run-anon",
        mode: "blitz",
        score: 4,
        seasonId: "2026-07",
        completedAt: "2026-07-18T12:02:00.000Z",
      }),
      fetcher,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
