import { describe, expect, it, vi } from "vitest";
import {
  bridgeStartedWebhookPayload,
  playerPulledWebhookPayload,
  publishBridgeStartedEvent,
  publishPlayerPulledEvent,
} from "../src/discord.js";

const result = {
  version: 1 as const,
  type: "player-result" as const,
  jobId: "job-1",
  playerTag: "#2PYQ0",
  requestedAt: "2026-07-18T12:00:00.000Z",
  completedAt: "2026-07-18T12:00:01.000Z",
  outcome: "success" as const,
  player: {
    name: "CR Player",
    clan: {
      tag: "#P0QY",
      name: "POAP KINGS",
      badgeId: 16000000,
      role: "coLeader",
    },
    accountAge: { days: 2_930, years: 8 },
    cards: [{ id: 26000000, name: "Knight" }],
  },
};

describe("CR bridge Discord event", () => {
  it("keeps bridge startup notifications compact and identifies the process", () => {
    expect(bridgeStartedWebhookPayload(98_235)).toEqual({
      username: "Elixir Drop Events",
      allowed_mentions: { parse: [] },
      content: "🟢 CR bridge online · process 98235",
    });
  });

  it("includes useful fetch metadata without rank or card levels", () => {
    const payload = playerPulledWebhookPayload(result, 321);
    const serialized = JSON.stringify(payload);

    expect(payload.content).toBe(
      "🔄 CR loaded · CR Player (#2PYQ0) · POAP KINGS · 1 card · 8y 10d account · 321ms",
    );
    expect(payload).not.toHaveProperty("embeds");
    expect(serialized).not.toContain("troph");
    expect(serialized).not.toContain("level");
    expect(serialized).not.toContain("job-1");
  });

  it("does not let webhook delivery block the bridge", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      publishPlayerPulledEvent(
        "https://discord.example/webhook",
        result,
        321,
        async () => ({ ok: false, status: 429 }),
      ),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "Discord bridge event failed with HTTP 429.",
    );
    warn.mockRestore();
  });

  it("does not let startup event delivery block the bridge", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      publishBridgeStartedEvent(
        "https://discord.example/webhook",
        98_235,
        async () => ({ ok: false, status: 429 }),
      ),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "Discord bridge startup event failed with HTTP 429.",
    );
    warn.mockRestore();
  });
});
