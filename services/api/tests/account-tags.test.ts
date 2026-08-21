import { describe, expect, it } from "vitest";
import { accountTagsForPlayerId } from "../src/account-tags.js";
import { publicProfile } from "../src/public-profile.js";
import { profileResponse } from "../src/routes/context.js";

const developers = [
  "dedcd791-38e5-4c5b-9b41-19ee7345edd2",
  "3d63654b-0da0-40af-b298-5814c7a0939c",
] as const;

describe("public account tags", () => {
  it.each(developers)(
    "marks developer account %s on every profile shape",
    (playerId) => {
      expect(accountTagsForPlayerId(playerId)).toEqual(["developer"]);
      expect(
        publicProfile({
          playerId,
          publicName: "Builder",
          totalGames: 4,
          xp: 20,
        }),
      ).toMatchObject({ id: playerId, accountTags: ["developer"] });
      expect(
        profileResponse({
          sub: "private-sub",
          playerId,
          email: "builder@example.com",
          publicName: "Builder",
          totalGames: 4,
          xp: 20,
          createdAt: "2026-08-21T00:00:00.000Z",
          updatedAt: "2026-08-21T00:00:00.000Z",
        }),
      ).toMatchObject({ id: playerId, accountTags: ["developer"] });
    },
  );

  it("leaves ordinary accounts untagged and returns defensive copies", () => {
    const first = accountTagsForPlayerId(developers[0]);
    first.length = 0;
    expect(accountTagsForPlayerId(developers[0])).toEqual(["developer"]);
    expect(
      publicProfile({ playerId: "player-3", totalGames: 0 }),
    ).not.toHaveProperty("accountTags");
  });
});
