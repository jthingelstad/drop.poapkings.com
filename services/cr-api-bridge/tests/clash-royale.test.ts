import { describe, expect, it, vi } from "vitest";
import { fetchPlayer, normalizePlayer } from "../src/clash-royale.js";

const request = {
  version: 1 as const,
  type: "refresh-player" as const,
  jobId: "job-1",
  playerTag: "#2PYQ0",
  requestedAt: "2026-07-18T12:00:00.000Z",
};

function jsonResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const noDelay = vi.fn(async () => undefined);

describe("Clash Royale player normalization", () => {
  it("keeps practice context and drops rank and card levels", () => {
    const player = normalizePlayer({
      name: "CR Player",
      expLevel: 75,
      trophies: 10_000,
      bestTrophies: 11_000,
      arena: { id: 1, name: "Ranked Arena" },
      clan: { tag: "#P0QY", name: "POAP KINGS", badgeId: 16000000 },
      role: "coLeader",
      badges: [
        { name: "YearsPlayed", level: 7, progress: 2_930 },
        { name: "BattleWins", level: 10, progress: 10_000 },
      ],
      cards: [
        {
          id: 26000001,
          name: "Archers",
          level: 16,
          maxLevel: 16,
          count: 0,
          iconUrls: { medium: "https://assets.example/archers.png" },
        },
        {
          id: 26000000,
          name: "Knight",
          level: 16,
          iconUrls: { medium: "https://assets.example/knight.png" },
        },
      ],
    });

    expect(player).toEqual({
      name: "CR Player",
      clan: {
        tag: "#P0QY",
        name: "POAP KINGS",
        badgeId: 16000000,
        role: "coLeader",
      },
      accountAge: { days: 2_930, years: 8 },
      cards: [
        {
          id: 26000001,
          name: "Archers",
          iconUrl: "https://assets.example/archers.png",
        },
        {
          id: 26000000,
          name: "Knight",
          iconUrl: "https://assets.example/knight.png",
        },
      ],
    });
    expect(player).not.toHaveProperty("trophies");
    expect(player).not.toHaveProperty("arena");
    expect(player.cards[0]).not.toHaveProperty("level");
  });

  it("falls back to the badge tier when its day count is unavailable", () => {
    const player = normalizePlayer({
      name: "CR Player",
      badges: [{ name: "YearsPlayed", level: 3 }],
      cards: [{ id: 26000000, name: "Knight" }],
    });

    expect(player.accountAge).toEqual({ days: undefined, years: 3 });
  });
});

describe("Clash Royale player fetch outcomes", () => {
  it("maps a 404 to not_found without retrying", async () => {
    const fetcher = vi.fn(async () => jsonResponse(404, {}));
    const result = await fetchPlayer(request, "key", fetcher, noDelay);
    expect(result.outcome).toBe("not_found");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 honoring Retry-After, then succeeds", async () => {
    const delays: number[] = [];
    const delay = vi.fn(async (ms: number) => {
      delays.push(ms);
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, {}, { "retry-after": "2" }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          name: "CR Player",
          cards: [{ id: 26000000, name: "Knight" }],
        }),
      );
    const result = await fetchPlayer(request, "key", fetcher, delay);
    expect(result.outcome).toBe("success");
    expect(delays).toEqual([2_000]);
  });

  it("resolves persistent 503s as unavailable instead of throwing", async () => {
    // A thrown error burned five SQS redeliveries into the DLQ and stranded
    // the profile on "pending" forever.
    const fetcher = vi.fn(async () => jsonResponse(503, {}));
    const result = await fetchPlayer(request, "key", fetcher, noDelay);
    expect(result.outcome).toBe("unavailable");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("resolves network failures and unusable 200s as unavailable", async () => {
    const failing = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    await expect(
      fetchPlayer(request, "key", failing, noDelay),
    ).resolves.toMatchObject({ outcome: "unavailable" });

    const garbage = vi.fn(async () => jsonResponse(200, { nonsense: true }));
    await expect(
      fetchPlayer(request, "key", garbage, noDelay),
    ).resolves.toMatchObject({ outcome: "unavailable" });
  });
});
