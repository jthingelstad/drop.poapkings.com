import { describe, expect, it } from "vitest";
import { normalizePlayer } from "../src/clash-royale.js";

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
        { name: "YearsPlayed", level: 8, progress: 2_930 },
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
});
