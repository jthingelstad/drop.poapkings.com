import { describe, expect, it, vi } from "vitest";
import { loginWebhookPayload, publishDiscordEvent } from "../src/discord.js";
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

describe("Discord event notifications", () => {
  it("builds a compact login line from useful profile metadata", () => {
    const payload = loginWebhookPayload({
      profile,
      newPlayer: false,
    });

    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.content).toBe(
      "🔐 Login · returning · Inferno Dragon Main · 14 games · #2PYQ0",
    );
    expect(payload.content).not.toContain(profile.email);
    expect(payload).not.toHaveProperty("embeds");
    expect(JSON.stringify(payload)).not.toContain("email-subject");
    expect(JSON.stringify(payload)).not.toContain("player-123");
  });

  it("never derives Discord labels from a private email address", () => {
    const anonymousProfile = { ...profile, publicName: undefined };

    const content = loginWebhookPayload({
      profile: anonymousProfile,
      newPlayer: true,
    }).content;
    expect(content).toContain("unnamed player");
    expect(content).not.toContain(anonymousProfile.email);
  });

  it("posts JSON without allowing notification failures to escape", async () => {
    const payload = loginWebhookPayload({
      profile,
      newPlayer: true,
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
    expect(
      JSON.parse(typeof init?.body === "string" ? init.body : "{}"),
    ).toEqual(payload);

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
      loginWebhookPayload({ profile, newPlayer: false }),
      fetcher,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
