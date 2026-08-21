import { describe, expect, it, vi } from "vitest";
import { emptyCounters } from "../src/badges.js";
import {
  finalizePodiumBadges,
  finalizePreviousSeasonIfNeeded,
} from "../src/podium.js";
import type { Repository } from "../src/repository.js";

function repository(overrides: Record<string, unknown> = {}): Repository {
  return {
    seasonFinalists: vi.fn().mockResolvedValue([]),
    getBadges: vi.fn().mockResolvedValue({
      ...emptyCounters(),
      updatedAt: "2026-08-03T10:00:00.000Z",
    }),
    getProfile: vi.fn().mockResolvedValue({ xp: 0 }),
    badgeXpKeys: vi.fn().mockResolvedValue(new Set()),
    grantBadgeXpBatch: vi.fn().mockResolvedValue(true),
    grantXpOnce: vi.fn().mockResolvedValue(false),
    saveBadges: vi.fn().mockResolvedValue(true),
    savePodiumAward: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as Repository;
}

describe("podium finalization", () => {
  it("checks every ranked mode, excludes Practice, and awards each visible finish", async () => {
    const seasonFinalists = vi.fn().mockImplementation((mode: string) =>
      Promise.resolve(
        mode === "surge"
          ? [
              { sub: "player-a", rank: 1, score: 12_000 },
              { sub: "player-b", rank: 2, score: 13_000 },
            ]
          : [],
      ),
    );
    const savePodiumAward = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const repo = repository({ seasonFinalists, savePodiumAward });

    const summary = await finalizePodiumBadges(repo, {
      seasonId: "2026-07",
      finalizedAt: "2026-08-03T10:12:48.768Z",
    });

    expect(seasonFinalists.mock.calls.map(([mode]) => mode)).toEqual([
      "surge",
      "higher-lower",
      "trade",
      "survival",
      "rain",
    ]);
    expect(savePodiumAward).toHaveBeenCalledTimes(2);
    expect(savePodiumAward.mock.calls[0]?.slice(1, 4)).toEqual([
      "2026-07",
      "surge",
      expect.objectContaining({ values: { podium: 1 } }),
    ]);
    expect(summary).toEqual({
      seasonId: "2026-07",
      finishes: 2,
      awarded: 1,
      duplicates: 1,
      placementAwards: 0,
      placementDuplicates: 0,
      circuitAwards: 0,
      circuitDuplicates: 0,
      xpAwarded: 0,
    });
  });

  it("finalizes the stored season before a newer observed CR season is saved", async () => {
    const repo = repository({
      getCrWarClock: vi.fn().mockResolvedValue({
        crSeasonId: 134,
        leaderboardSeasonId: "2026-07",
        observedAt: "2026-08-03T09:57:44.917Z",
      }),
    });

    const result = await finalizePreviousSeasonIfNeeded(repo, {
      crSeasonId: 135,
      observedAt: "2026-08-03T10:12:48.768Z",
    });

    expect(result).toEqual({
      seasonId: "2026-07",
      finishes: 0,
      awarded: 0,
      duplicates: 0,
      placementAwards: 0,
      placementDuplicates: 0,
      circuitAwards: 0,
      circuitDuplicates: 0,
      xpAwarded: 0,
    });
  });

  it("pays each top-20 mode placement and the five-mode Seasonal Circuit once", async () => {
    const grantXpOnce = vi.fn().mockResolvedValue(true);
    const repo = repository({
      seasonFinalists: vi
        .fn()
        .mockResolvedValue([{ sub: "player-a", rank: 1, score: 100 }]),
      grantXpOnce,
      savePodiumAward: vi.fn().mockResolvedValue(false),
    });

    await expect(
      finalizePodiumBadges(repo, {
        seasonId: "2026-08",
        finalizedAt: "2026-09-07T10:00:00.000Z",
      }),
    ).resolves.toEqual({
      seasonId: "2026-08",
      finishes: 5,
      awarded: 0,
      duplicates: 5,
      placementAwards: 5,
      placementDuplicates: 0,
      circuitAwards: 1,
      circuitDuplicates: 0,
      xpAwarded: 2_600,
    });
    expect(grantXpOnce).toHaveBeenCalledTimes(6);
  });

  it("does not finalize on same-season or stale out-of-order clock results", async () => {
    const getCrWarClock = vi.fn().mockResolvedValue({
      crSeasonId: 135,
      leaderboardSeasonId: "2026-08",
      observedAt: "2026-08-03T10:12:48.768Z",
    });
    const seasonFinalists = vi.fn();
    const repo = repository({ getCrWarClock, seasonFinalists });

    await expect(
      finalizePreviousSeasonIfNeeded(repo, {
        crSeasonId: 135,
        observedAt: "2026-08-03T10:20:00.000Z",
      }),
    ).resolves.toBeUndefined();
    await expect(
      finalizePreviousSeasonIfNeeded(repo, {
        crSeasonId: 134,
        observedAt: "2026-08-03T10:00:00.000Z",
      }),
    ).resolves.toBeUndefined();
    expect(seasonFinalists).not.toHaveBeenCalled();
  });
});
