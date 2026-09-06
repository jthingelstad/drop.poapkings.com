import { describe, expect, it, vi } from "vitest";
import { callTool, addPlayerToCollection } from "../src/elixir-mcp.js";
import { rememberPlayerInCollection } from "../src/elixir-collection.js";
import {
  fetchPlayerFromHub,
  normalizeHubPlayer,
  normalizeRecordedPlayer,
} from "../src/elixir-player.js";
import { fetchWarClockFromHub, toWarClock } from "../src/elixir-war-clock.js";
import type { Config } from "../src/config.js";

const config = {
  baseUrl: "https://elixir.example",
  token: "svt_test",
};

/** The hub answers JSON-RPC; tool results arrive as JSON in content[0].text. */
function hubReply(payload: unknown, isError = false) {
  return vi.fn(async (_url: string, _init: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => ({
      jsonrpc: "2.0",
      id: 1,
      result: { isError, content: [{ text: JSON.stringify(payload) }] },
    }),
    text: async () => "",
  }));
}

describe("Elixir MCP client", () => {
  it("calls one tool over JSON-RPC with the service token", async () => {
    const fetcher = hubReply({ slug: "elixir-drop", added: 1, members: 14 });
    const result = await callTool(
      config,
      "collections_edit",
      { slug: "elixir-drop", action: "add", tags: ["#2YG98VVQ"] },
      fetcher,
    );
    expect(result).toMatchObject({ added: 1, members: 14 });
    const call = fetcher.mock.calls[0]!;
    expect(call[0]).toBe("https://elixir.example/mcp");
    expect((call[1].headers as Record<string, string>).Authorization).toBe(
      "Bearer svt_test",
    );
    const body: {
      method: string;
      params: { name: string; arguments: { tags: string[] } };
    } = JSON.parse(call[1].body as string);
    expect(body.method).toBe("tools/call");
    expect(body.params.name).toBe("collections_edit");
    expect(body.params.arguments.tags).toEqual(["#2YG98VVQ"]);
  });

  it("turns a tool refusal into a throw, not a silent success", async () => {
    // The hub reports tool failures as a RESULT carrying isError, so a
    // naive client would read a refusal as a successful call.
    const fetcher = hubReply(
      { error: "not_entitled", message: "'x' belongs to someone else." },
      true,
    );
    await expect(
      callTool(config, "collections_edit", {}, fetcher),
    ).rejects.toThrow(/belongs to someone else/);
  });

  it("surfaces the shared rate limit distinctly", async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: false,
      status: 429,
      json: async () => ({}),
      text: async () => "",
    }));
    await expect(
      callTool(config, "collections_edit", {}, fetcher),
    ).rejects.toMatchObject({ status: 429, code: "rate_limited" });
  });

  it("refuses to call at all when the hub is unconfigured", async () => {
    const fetcher = hubReply({});
    await expect(
      callTool({ baseUrl: "https://elixir.example" }, "x", {}, fetcher),
    ).rejects.toMatchObject({ code: "unconfigured" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("dedupes tags and skips the call when there is nothing to add", async () => {
    const fetcher = hubReply({ added: 1 });
    await addPlayerToCollection(
      config,
      "elixir-drop",
      ["#2YG98VVQ", "#2YG98VVQ"],
      fetcher,
    );
    const sent: { params: { arguments: { tags: string[] } } } = JSON.parse(
      fetcher.mock.calls[0]![1].body as string,
    );
    expect(sent.params.arguments.tags).toEqual(["#2YG98VVQ"]);

    const idle = hubReply({});
    expect(
      await addPlayerToCollection(config, "elixir-drop", [], idle),
    ).toBeUndefined();
    expect(idle).not.toHaveBeenCalled();
  });
});

describe("collection membership on the Drop side", () => {
  const dropConfig = {
    elixirMcpBaseUrl: "https://elixir.example",
    elixirMcpKey: "svt_test",
    elixirMcpCollectionSlug: "elixir-drop",
  } as Config;

  it("adds a saved tag", async () => {
    const fetcher = hubReply({ added: 1, members: 1 });
    await rememberPlayerInCollection(dropConfig, "#2YG98VVQ", fetcher);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("does nothing for an account with no tag", async () => {
    // Most Drop accounts have none: the tag is optional and stays out
    // of setup, so this is the common path, not an edge case.
    const fetcher = hubReply({});
    await rememberPlayerInCollection(dropConfig, undefined, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does nothing when the hub is not wired", async () => {
    const fetcher = hubReply({});
    await rememberPlayerInCollection(
      { ...dropConfig, elixirMcpKey: undefined } as Config,
      "#2YG98VVQ",
      fetcher,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("never lets a hub outage fail the login that triggered it", async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => {
      throw new Error("connect ECONNREFUSED");
    });
    await expect(
      rememberPlayerInCollection(dropConfig, "#2YG98VVQ", fetcher),
    ).resolves.toBeUndefined();
  });
});

describe("player enrichment from the hub", () => {
  const raw = {
    tag: "#UL2V9QRG0",
    name: "raquaza",
    role: "coLeader",
    clan: { tag: "#J2RGCRVG", name: "POAP KINGS", badgeId: 16000107 },
    badges: [
      { name: "BattleWins", level: 5, progress: 2479 },
      { name: "YearsPlayed", level: 4, progress: 1637, target: 1825 },
    ],
    cards: [
      { id: 26000000, name: "Knight", iconUrls: { medium: "https://x/k.png" } },
    ],
  };

  it("keeps exactly what Drop renders", () => {
    const player = normalizeHubPlayer(raw);
    expect(player.name).toBe("raquaza");
    expect(player.clan).toEqual({
      tag: "#J2RGCRVG",
      name: "POAP KINGS",
      badgeId: 16000107,
      role: "coLeader",
    });
    // Account age is the YearsPlayed badge; progress is days played.
    expect(player.accountAge).toEqual({ days: 1637, years: 4 });
  });

  it("does not keep the card collection", () => {
    // Drop collected every card, shipped the array to the browser on
    // every /me, and read it nowhere. The mode that dealt from it was
    // removed in July 2026 and is prohibited in CLAUDE.md and SPEC.md.
    expect(normalizeHubPlayer(raw)).not.toHaveProperty("cards");
  });

  it("tolerates a player with no clan and no badges", () => {
    const player = normalizeHubPlayer({ name: "Solo" });
    expect(player).toEqual({
      name: "Solo",
      clan: undefined,
      accountAge: undefined,
    });
  });

  it("drops a clan missing its badge rather than storing half of one", () => {
    const player = normalizeHubPlayer({
      name: "x",
      clan: { tag: "#A", name: "A" },
      role: "member",
    });
    expect(player.clan).toBeUndefined();
  });

  it("refuses a payload with no name", () => {
    expect(() => normalizeHubPlayer({ tag: "#A" })).toThrow(/invalid player/);
  });

  it("percent-encodes the tag on the live passthrough", async () => {
    // Reached only when the record cannot answer; the hash in a Clash
    // Royale tag has to survive into the path.
    let call = 0;
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => {
      call += 1;
      const result =
        call === 1
          ? {
              isError: true,
              content: [{ text: JSON.stringify({ error: "not_recorded" }) }],
            }
          : { content: [{ text: JSON.stringify({ data: raw }) }] };
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: call, result }),
        text: async () => "",
      };
    });
    const player = await fetchPlayerFromHub(
      {
        elixirMcpBaseUrl: "https://elixir.example",
        elixirMcpKey: "svt_test",
      } as Config,
      "#UL2V9QRG0",
      fetcher,
    );
    expect(player.name).toBe("raquaza");
    const sent: { params: { name: string; arguments: { path: string } } } =
      JSON.parse(fetcher.mock.calls[1]![1].body as string);
    expect(sent.params.name).toBe("live_fetch");
    expect(sent.params.arguments.path).toBe("/players/%23UL2V9QRG0");
  });
});

describe("the Clan Wars clock from the hub", () => {
  const warCurrent = {
    clan_tag: "#J2RGCRVG",
    season_id: 135,
    section_index: 4,
    is_colosseum: false,
    period: {
      period_index: 34,
      kind: "war",
      started_observed_at: "2026-09-06T09:57:37.000Z",
    },
  };

  it("maps the hub's clock onto the shape Drop stores", () => {
    const clock = toWarClock(
      warCurrent,
      "#J2RGCRVG",
      new Date("2026-09-06T12:00:00.000Z"),
    );
    expect(clock.crSeasonId).toBe(135);
    expect(clock.sectionIndex).toBe(4);
    expect(clock.periodIndex).toBe(34);
    expect(clock.periodType).toBe("warDay");
    // The season opened periodIndex days before this period did. The
    // anchor is the OBSERVED open, not an assumed 10:00 UTC reset.
    expect(clock.seasonStartsAt).toBe("2026-08-03T09:57:37.000Z");
    expect(clock.sourceClanTag).toBe("#J2RGCRVG");
  });

  it("calls colosseum weeks colosseum, whatever the period kind says", () => {
    const clock = toWarClock(
      { ...warCurrent, is_colosseum: true },
      "#J2RGCRVG",
    );
    expect(clock.periodType).toBe("colosseum");
  });

  it("maps a training day", () => {
    const clock = toWarClock(
      {
        ...warCurrent,
        period: { ...warCurrent.period, kind: "training", period_index: 2 },
      },
      "#J2RGCRVG",
    );
    expect(clock.periodType).toBe("training");
  });

  it("refuses an out-of-range index rather than back-dating a season", () => {
    // A five-week season has at most 5 sections of 7 periods; a glitched
    // index would move the season start by months.
    expect(() =>
      toWarClock(
        { ...warCurrent, period: { ...warCurrent.period, period_index: 99 } },
        "#J2RGCRVG",
      ),
    ).toThrow(/out-of-range/);
  });

  it("refuses when the hub has not observed a period open", () => {
    expect(() =>
      toWarClock(
        { ...warCurrent, period: { period_index: 1, kind: "war" } },
        "#J2RGCRVG",
      ),
    ).toThrow(/observed period start/);
  });

  it("asks the hub for the configured clan", async () => {
    const fetcher = hubReply(warCurrent);
    const clock = await fetchWarClockFromHub(
      {
        elixirMcpBaseUrl: "https://elixir.example",
        elixirMcpKey: "svt_test",
        warClockClanTag: "#J2RGCRVG",
      } as Config,
      new Date("2026-09-06T12:00:00.000Z"),
      fetcher,
    );
    expect(clock.crSeasonId).toBe(135);
    const sent: { params: { name: string; arguments: { clan_tag: string } } } =
      JSON.parse(fetcher.mock.calls[0]![1].body as string);
    expect(sent.params.name).toBe("war_current");
    expect(sent.params.arguments.clan_tag).toBe("#J2RGCRVG");
  });
});

describe("enrichment prefers the record over a live read", () => {
  const dropConfig = {
    elixirMcpBaseUrl: "https://elixir.example",
    elixirMcpKey: "svt_test",
  } as Config;

  const recorded = {
    player_tag: "#UL2V9QRG0",
    name: "raquaza",
    clan: {
      clan_tag: "#J2RGCRVG",
      name: "POAP KINGS",
      badge_id: 16000107,
      role: "coLeader",
    },
    attributes: { years_played: 4, account_age_days: 1637 },
  };

  it("maps the recorded profile onto what Drop renders", () => {
    const player = normalizeRecordedPlayer(recorded);
    expect(player).toEqual({
      name: "raquaza",
      clan: {
        tag: "#J2RGCRVG",
        name: "POAP KINGS",
        badgeId: 16000107,
        role: "coLeader",
      },
      accountAge: { days: 1637, years: 4 },
    });
  });

  it("drops a recorded clan whose badge was never observed", () => {
    // Same rule as the live payload: half a clan is not stored.
    const player = normalizeRecordedPlayer({
      ...recorded,
      clan: { ...recorded.clan, badge_id: null },
    });
    expect(player?.clan).toBeUndefined();
  });

  it("reads history and never touches the live passthrough", async () => {
    const fetcher = hubReply(recorded);
    const player = await fetchPlayerFromHub(dropConfig, "#UL2V9QRG0", fetcher);
    expect(player.name).toBe("raquaza");
    expect(fetcher).toHaveBeenCalledOnce();
    const sent: { params: { name: string } } = JSON.parse(
      fetcher.mock.calls[0]![1].body as string,
    );
    expect(sent.params.name).toBe("players_profile");
  });

  it("falls back to a live read for a tag the hub has never seen", async () => {
    // The ordinary cold case: somebody just linked their tag.
    let call = 0;
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => {
      call += 1;
      const body =
        call === 1
          ? {
              isError: true,
              content: [
                {
                  text: JSON.stringify({
                    error: "not_recorded",
                    message: "#X is not in the record yet.",
                  }),
                },
              ],
            }
          : {
              content: [
                {
                  text: JSON.stringify({
                    data: { name: "Newcomer", badges: [] },
                  }),
                },
              ],
            };
      return {
        ok: true,
        status: 200,
        json: async () => ({ jsonrpc: "2.0", id: call, result: body }),
        text: async () => "",
      };
    });
    const player = await fetchPlayerFromHub(dropConfig, "#XYZ", fetcher);
    expect(player.name).toBe("Newcomer");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const second: { params: { name: string } } = JSON.parse(
      fetcher.mock.calls[1]![1].body as string,
    );
    expect(second.params.name).toBe("live_fetch");
  });
});

describe("a season rollover still closes the previous season", () => {
  it("finalizes before storing, and only when the season id moves", async () => {
    // This ran off the bridge's war-clock result. When the bridge was
    // retired it had to come with the clock; missing it would have meant
    // podium badges and placement XP silently stopped being awarded at
    // the season boundary, with nothing failing.
    const { finalizePreviousSeasonIfNeeded } = await import("../src/podium.js");
    const calls: { seasonId: number }[] = [];
    const repository = {
      getCrWarClock: async () => ({
        crSeasonId: 134,
        observedAt: "2026-08-01T10:00:00.000Z",
      }),
      seasonFinalists: async () => {
        calls.push({ seasonId: 134 });
        return [];
      },
    } as never;

    // A newer clock carrying a NEW season closes the old one.
    await finalizePreviousSeasonIfNeeded(repository, {
      crSeasonId: 135,
      observedAt: "2026-09-01T10:00:00.000Z",
    });
    expect(calls.length).toBeGreaterThan(0);

    // The same season, arriving repeatedly, must not re-finalize.
    calls.length = 0;
    await finalizePreviousSeasonIfNeeded(repository, {
      crSeasonId: 134,
      observedAt: "2026-09-01T10:00:00.000Z",
    });
    expect(calls).toEqual([]);
  });
});
