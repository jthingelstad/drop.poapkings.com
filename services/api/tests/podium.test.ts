import { describe, expect, it, vi } from "vitest";
import { emptyCounters } from "../src/badges.js";
import {
  finalizePodiumBadges,
  finalizePreviousSeasonIfNeeded,
} from "../src/podium.js";
import type { Repository } from "../src/repository.js";

function repository(overrides: Record<string, unknown> = {}): Repository {
  return {
    podiumFinishers: vi.fn().mockResolvedValue([]),
    getBadges: vi.fn().mockResolvedValue({
      ...emptyCounters(),
      updatedAt: "2026-08-03T10:00:00.000Z",
    }),
    savePodiumAward: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as Repository;
}

describe("podium finalization", () => {
  it("checks every ranked mode, excludes Practice, and awards each visible finish", async () => {
    const podiumFinishers = vi
      .fn()
      .mockImplementation((mode: string) =>
        Promise.resolve(mode === "surge" ? ["player-a", "player-b"] : []),
      );
    const savePodiumAward = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const repo = repository({ podiumFinishers, savePodiumAward });

    const summary = await finalizePodiumBadges(repo, {
      seasonId: "2026-07",
      finalizedAt: "2026-08-03T10:12:48.768Z",
    });

    expect(podiumFinishers.mock.calls.map(([mode]) => mode)).toEqual([
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
    });
  });

  it("does not finalize on same-season or stale out-of-order clock results", async () => {
    const getCrWarClock = vi.fn().mockResolvedValue({
      crSeasonId: 135,
      leaderboardSeasonId: "2026-08",
      observedAt: "2026-08-03T10:12:48.768Z",
    });
    const podiumFinishers = vi.fn();
    const repo = repository({ getCrWarClock, podiumFinishers });

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
    expect(podiumFinishers).not.toHaveBeenCalled();
  });
});
