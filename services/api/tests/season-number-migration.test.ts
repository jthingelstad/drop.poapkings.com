import { describe, expect, it } from "vitest";
import { planSeasonNumberMigration } from "../src/maintenance/season-number-migration.js";

describe("season number migration planning", () => {
  it("updates ordinary season attributes and leaderboard projections", () => {
    expect(
      planSeasonNumberMigration({
        pk: "PLAYER#private",
        sk: "RUN#2026-08-01T00:00:00.000Z#run",
        seasonId: "2026-08",
        GSI1PK: "LEADERBOARD#2026-08#surge",
      }),
    ).toEqual({
      action: {
        kind: "update",
        key: {
          pk: "PLAYER#private",
          sk: "RUN#2026-08-01T00:00:00.000Z#run",
        },
        legacySeasonId: "2026-08",
        seasonId: 135,
        legacyGsi1pk: "LEADERBOARD#2026-08#surge",
        gsi1pk: "LEADERBOARD#135#surge",
        removeLeaderboardSeasonId: false,
      },
    });
  });

  it("rewrites feed and podium primary keys without touching timestamp keys", () => {
    expect(
      planSeasonNumberMigration({
        pk: "FEED#2026-07",
        sk: "2026-07-31T23:00:00.000Z#run",
      }).action,
    ).toMatchObject({
      kind: "rewrite",
      seasonId: 134,
      shape: "feed",
      item: { pk: "FEED#134", sk: "2026-07-31T23:00:00.000Z#run" },
    });
    expect(
      planSeasonNumberMigration({
        pk: "PLAYER#private",
        sk: "PODIUM#2026-07#surge",
        seasonId: "2026-07",
      }).action,
    ).toMatchObject({
      kind: "rewrite",
      seasonId: 134,
      shape: "podium",
      item: { sk: "PODIUM#134#surge", seasonId: 134 },
    });
    expect(
      planSeasonNumberMigration({
        pk: "PLAYER#private",
        sk: "RUN#2026-07-31T23:00:00.000Z#run",
      }),
    ).toEqual({});
  });

  it("removes the retired war-clock attribute and refuses disagreement", () => {
    expect(
      planSeasonNumberMigration({
        pk: "CR_WAR_CLOCK",
        sk: "CURRENT",
        crSeasonId: 135,
        leaderboardSeasonId: "2026-08",
      }).action,
    ).toMatchObject({ kind: "update", removeLeaderboardSeasonId: true });
    expect(
      planSeasonNumberMigration({
        pk: "PLAYER#private",
        sk: "PODIUM#2026-07#surge",
        seasonId: "2026-08",
      }),
    ).toEqual({ unresolved: "embedded key and seasonId disagree" });
  });
});
