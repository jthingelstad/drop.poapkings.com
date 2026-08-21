import { describe, expect, it, vi } from "vitest";
import { emptyCounters, recordPodiumFinish } from "../src/badges.js";
import type { BadgeXpGrant, Repository } from "../src/repository.js";
import { settleBadgeXp } from "../src/xp-awards.js";

describe("badge XP reconciliation", () => {
  it("retroactively awards rung markers and settles the Arena Climber cascade", async () => {
    const markers = new Set<string>();
    let xp = 195;
    const saveBadges = vi.fn().mockResolvedValue(true);
    const repository = {
      badgeXpKeys: vi.fn(async () => new Set(markers)),
      grantBadgeXpBatch: vi.fn(async (_sub: string, grants: BadgeXpGrant[]) => {
        for (const grant of grants) markers.add(grant.key);
        xp += grants.reduce((total, grant) => total + grant.amount, 0);
        return true;
      }),
      getProfile: vi.fn(async () => ({ xp })),
      saveBadges,
      getBadges: vi.fn(),
    } as unknown as Repository;
    const at = "2026-08-21T12:00:00.000Z";
    const podium = recordPodiumFinish(emptyCounters(), at).counters;

    const result = await settleBadgeXp(repository, "player-a", podium, at, {
      version: podium.version,
      updatedAt: at,
    });

    expect(result.awarded).toBe(10);
    expect(xp).toBe(205);
    expect(markers).toEqual(
      new Set(["BADGE#podium#0", "BADGE#arena-climber#0"]),
    );
    expect(result.counters.values["arena-climber"]).toBe(4);
    expect(result.newlyEarned).toContainEqual(
      expect.objectContaining({ slug: "arena-climber", rungIndex: 0 }),
    );
    expect(saveBadges).toHaveBeenCalledOnce();
  });
});
