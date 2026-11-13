import { describe, expect, it, vi } from "vitest";
import {
  crSnapshotFromElixir,
  publicCrProfile,
  recordCrProfileFromElixir,
} from "../src/cr-profile.js";

const KING = {
  playerTag: "#20JJJ2CCRU",
  name: "King Thing",
  relationship: "primary" as const,
  verified: true,
  clanTag: "#J2RGCRVG",
  clanName: "POAP KINGS",
  clanRole: "leader",
};
const AT = "2026-11-13T18:00:00.000Z";

// Drop learns a player's name and clan only from the sign-in read
// (2026-11-13). Nothing polls and nothing refreshes in the background.
describe("the Clash Royale profile Drop shows", () => {
  it("is not read yet, never pending, until a sign-in stores it", () => {
    expect(publicCrProfile("#2PYQ0", undefined)).toEqual({
      tag: "#2PYQ0",
      status: "unavailable",
    });
    // Snapshots from the retired background refresh read the same way.
    for (const status of ["pending", "not_found", "unavailable"] as const)
      expect(
        publicCrProfile("#2PYQ0", { tag: "#2PYQ0", status, updatedAt: AT }),
      ).toEqual({ tag: "#2PYQ0", status: "unavailable" });
  });

  it("shows a ready snapshot's name and clan and nothing else", () => {
    const stored = {
      ...crSnapshotFromElixir(KING, AT)!,
      accountAge: { days: 3_000 },
      refreshRequestedAt: AT,
    };
    expect(publicCrProfile(KING.playerTag, stored)).toEqual({
      tag: "#20JJJ2CCRU",
      status: "ready",
      name: "King Thing",
      clan: { tag: "#J2RGCRVG", name: "POAP KINGS", role: "leader" },
      fetchedAt: AT,
    });
  });

  it("stores a clan only with its tag and its name, and a player only with a name", () => {
    expect(
      crSnapshotFromElixir({ ...KING, clanName: undefined }, AT),
    ).not.toHaveProperty("clan");
    expect(crSnapshotFromElixir({ ...KING, name: undefined }, AT)).toBe(
      undefined,
    );
  });

  it("never fails a sign-in over a failed write", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const repository = {
      saveCrProfileFromElixir: vi.fn().mockRejectedValue(new Error("down")),
    };
    await expect(
      recordCrProfileFromElixir(repository, KING, AT),
    ).resolves.toBeUndefined();
    await recordCrProfileFromElixir(repository, undefined, AT);
    expect(repository.saveCrProfileFromElixir).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("King Thing");
    warn.mockRestore();
  });
});
