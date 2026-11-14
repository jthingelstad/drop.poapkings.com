import { describe, expect, it } from "vitest";
import {
  GAME_NAME_MAX,
  parseElixirMe,
  tidyGameName,
} from "../src/elixir-identity.js";

const primary = (name: unknown, extra: Record<string, unknown> = {}) => ({
  player_tag: "#20JJJ2CCRU",
  name,
  relationship: "primary",
  is_primary: true,
  claim_status: "verified",
  ...extra,
});

describe("the /me adapter", () => {
  it("reads the 5.1.0 avatar, its null, and its absence differently", () => {
    expect(
      parseElixirMe({
        players: [primary("King Thing")],
        avatar: {
          card_id: 26000000,
          name: "Knight",
          art_url: "https://elixir.poapkings.com/assets/cards/26000000.png",
          crop: { x: 50, y: 32, scale: 1.25 },
        },
      }).identity,
    ).toEqual({ primaryName: "King Thing", avatarCardId: 26000000 });
    // A card Elixir has and Drop's catalog lacks is no picture in Drop.
    expect(
      parseElixirMe({ avatar: { card_id: 28000025, crop: {} } }).identity,
    ).toEqual({ avatarCardId: null });
    expect(parseElixirMe({ avatar: null }).identity).toEqual({
      avatarCardId: null,
    });
    // Not said: Drop keeps what it has.
    expect(parseElixirMe({}).identity).toEqual({});
    // A string id, or a card Drop does not hold, is no picture.
    expect(parseElixirMe({ avatar: { card_id: "26000000" } }).identity).toEqual(
      { avatarCardId: null },
    );
  });

  it("takes the is_primary player, whatever the row order", () => {
    const { identity } = parseElixirMe({
      players: [
        { ...primary("Sample Alt"), relationship: "alt", is_primary: false },
        primary("Sample Primary"),
      ],
    });
    expect(identity.primaryName).toBe("Sample Primary");
  });

  it("takes the primary player's name whether or not Elixir verified it", () => {
    const unverified = parseElixirMe({
      players: [primary("Sample Primary", { claim_status: "unverified" })],
    });
    expect(unverified.identity.primaryName).toBe("Sample Primary");
    // The verified fact rides separately, for the mark beside the name.
    expect(unverified.players[0]?.verified).toBe(false);
    const pending = parseElixirMe({
      players: [primary("Sample Primary", { claim_status: "pending" })],
    });
    expect(pending.identity.primaryName).toBe("Sample Primary");
    expect(pending.players[0]?.verified).toBe(false);
    const verified = parseElixirMe({ players: [primary("Sample Primary")] });
    expect(verified.players[0]?.verified).toBe(true);
  });

  it("has no name when the primary's name tidies to nothing or is missing", () => {
    const rlo = String.fromCodePoint(0x202e);
    expect(
      parseElixirMe({ players: [primary(` ${rlo}\t `)] }).identity.primaryName,
    ).toBeUndefined();
    expect(
      parseElixirMe({ players: [primary(undefined)] }).identity.primaryName,
    ).toBeUndefined();
    expect(parseElixirMe({ players: [] }).identity.primaryName).toBeUndefined();
  });

  it("never takes a friend's, watched player's or alt's name", () => {
    const { players, identity } = parseElixirMe({
      players: [
        { ...primary("An Alt"), relationship: "alt", is_primary: false },
        { ...primary("A Friend"), relationship: "friend" },
        { ...primary("Watched"), relationship: "watching" },
      ],
    });
    expect(players.map((p) => p.relationship)).toEqual(["alt"]);
    expect(identity.primaryName).toBeUndefined();
  });
});

describe("hostile game names", () => {
  it("strips control, direction and invisible characters and collapses space", () => {
    const rlo = String.fromCodePoint(0x202e);
    const zwj = String.fromCodePoint(0x200d);
    const lineSep = String.fromCodePoint(0x2028);
    expect(tidyGameName(`  Evil${rlo}gnp.exe  `)).toBe("Evilgnp.exe");
    expect(tidyGameName(`a\n\tb${lineSep}c${zwj}d\u0000`)).toBe("a b cd");
    expect(tidyGameName("   ")).toBeUndefined();
    expect(tidyGameName(42)).toBeUndefined();
  });

  it("keeps markup as text for the outputs to escape, and caps the length by characters", () => {
    expect(tidyGameName('<img src=x onerror="alert(1)">')).toBe(
      '<img src=x onerror="alert(1)">',
    );
    const long = "👑".repeat(GAME_NAME_MAX + 5);
    expect(Array.from(tidyGameName(long) ?? "")).toHaveLength(GAME_NAME_MAX);
  });
});
