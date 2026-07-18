import { describe, expect, it, vi } from "vitest";
import {
  playerPulledWebhookPayload,
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
  it("includes useful fetch metadata without rank or card levels", () => {
    const payload = playerPulledWebhookPayload(result, 321);
    const serialized = JSON.stringify(payload);

    expect(payload.embeds[0]?.title).toBe("Clash Royale Player Loaded");
    expect(serialized).toContain("#2PYQ0");
    expect(serialized).toContain("POAP KINGS · Co-leader");
    expect(serialized).toContain("8 years");
    expect(serialized).toContain("1 card");
    expect(serialized).not.toContain("troph");
    expect(serialized).not.toContain("level");
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
});
