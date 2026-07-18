import { describe, expect, it } from "vitest";
import { parseCrPlayerResult } from "../src/cr-results.js";

describe("CR bridge results", () => {
  it("accepts the narrow player profile contract", () => {
    expect(
      parseCrPlayerResult({
        version: 1,
        type: "player-result",
        jobId: "job-1",
        playerTag: "#2PYQ0",
        requestedAt: "2026-07-18T12:00:00.000Z",
        completedAt: "2026-07-18T12:00:01.000Z",
        outcome: "success",
        player: {
          name: "CR Player",
          clan: {
            tag: "#P0QY",
            name: "POAP KINGS",
            badgeId: 16000000,
            role: "coLeader",
          },
          accountAge: { days: 2_930, years: 7 },
          cards: [
            {
              id: 26000000,
              name: "Knight",
              iconUrl:
                "https://api-assets.clashroyale.com/cards/300/knight.png",
            },
          ],
        },
      }),
    ).toMatchObject({
      outcome: "success",
      playerTag: "#2PYQ0",
      player: {
        name: "CR Player",
        accountAge: { days: 2_930, years: 8 },
        cards: [{ id: 26000000, name: "Knight" }],
      },
    });
  });

  it("rejects competitive fields and malformed card data by omission", () => {
    const result = parseCrPlayerResult({
      version: 1,
      type: "player-result",
      jobId: "job-1",
      playerTag: "#2PYQ0",
      requestedAt: "2026-07-18T12:00:00.000Z",
      completedAt: "2026-07-18T12:00:01.000Z",
      outcome: "success",
      player: {
        name: "CR Player",
        trophies: 9_999,
        arena: { name: "Ranked" },
        expLevel: 75,
        cards: [{ id: 26000000, name: "Knight", level: 16 }],
      },
    });

    expect(result).not.toHaveProperty("player.trophies");
    expect(result).not.toHaveProperty("player.arena");
    expect(result).not.toHaveProperty("player.expLevel");
    expect(result).not.toHaveProperty("player.cards.0.level");
  });
});
