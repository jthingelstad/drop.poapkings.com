import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../src/errors.js";
import {
  MAX_UPDATE_BODY_WORDS,
  MAX_UPDATE_TITLE_CHARACTERS,
  renderUpdateMarkdownHtml,
  type UpdateEntry,
} from "../src/player-updates.js";
import {
  escapeDisplayName,
  publishPendingSeasonPosts,
  renderFinalResults,
  renderOpeningBell,
  seasonPostScore,
  type SeasonPostLeader,
  type SeasonPostsRecord,
} from "../src/season-posts.js";

const AT = "2026-12-07T10:05:00.000Z";

const fullBoards: SeasonPostLeader[] = [
  { mode: "surge", publicName: "Log", score: 11_720 },
  { mode: "higher-lower", publicName: "Hog Rider Sprinter", score: 109 },
  { mode: "trade", publicName: "Log", score: 38_847 },
  { mode: "survival", publicName: "Pekka Brain", score: 120 },
  { mode: "rain", publicName: "Log", score: 190 },
];

function record(overrides: Partial<SeasonPostsRecord> = {}): SeasonPostsRecord {
  return {
    closedSeasonId: 138,
    openingSeasonId: 139,
    closedAt: AT,
    openingSeasonEndsAt: "2027-01-04T10:00:00.000Z",
    leaders: fullBoards,
    posted: {},
    ...overrides,
  };
}

function words(body: string): number {
  return body.split(/\s+/).length;
}

function expectWithinLimits(entry: UpdateEntry) {
  expect(entry.kind).toBe("season");
  expect(entry.title.length).toBeLessThanOrEqual(MAX_UPDATE_TITLE_CHARACTERS);
  expect(words(entry.body)).toBeLessThanOrEqual(MAX_UPDATE_BODY_WORDS);
  expect(() => renderUpdateMarkdownHtml(entry.body)).not.toThrow();
}

describe("season post templates", () => {
  it("names each game's #1 at the close with the game's own score format", () => {
    const entry = renderFinalResults(record(), AT);
    expectWithinLimits(entry);
    expect(entry).toMatchObject({
      id: "season-138-final-results",
      title: "Season 138 is final",
      publishedAt: AT,
    });
    expect(entry.body).toBe(
      "Season 138 is in the books. Surge: Log at **11.720s**. Higher / Lower: Hog Rider Sprinter at **109 correct**. Trade: Log at **38.847s**. Survival: Pekka Brain at **120 streak**. Rain: Log at **190 cleared**. Bragging rights are official. [See the final boards](/#/leaderboards?season=138).",
    );
    // Rain's own unit is "cleared"; the retired seal word is capitalized.
    expect(entry.body).not.toMatch(/Cleared|Awaiting|seal/);
    expect(entry.body).not.toMatch(/free pass|prize|winner/i);
  });

  it("formats every ranked game the way the boards do", () => {
    expect(seasonPostScore("surge", 9_005)).toBe("9.005s");
    expect(seasonPostScore("trade", 40_000)).toBe("40.000s");
    expect(seasonPostScore("higher-lower", 68)).toBe("68 correct");
    expect(seasonPostScore("survival", 87)).toBe("87 streak");
    expect(seasonPostScore("rain", 168)).toBe("168 cleared");
  });

  it("keeps board order and says which games nobody ranked in", () => {
    const entry = renderFinalResults(
      record({ leaders: [fullBoards[4]!, fullBoards[0]!] }),
      AT,
    );
    expectWithinLimits(entry);
    expect(entry.body).toContain(
      "Surge: Log at **11.720s**. Rain: Log at **190 cleared**. Nobody posted a ranked Higher / Lower, Trade, or Survival run.",
    );
    const two = renderFinalResults(
      record({ leaders: fullBoards.slice(0, 3) }),
      AT,
    );
    expect(two.body).toContain("Nobody posted a ranked Survival or Rain run.");
  });

  it("gives a season with no results at all a short honest line", () => {
    const entry = renderFinalResults(record({ leaders: [] }), AT);
    expectWithinLimits(entry);
    expect(entry).toMatchObject({
      id: "season-138-final-results",
      title: "Season 138 closed with empty boards",
      body: "Season 138 closed with all five boards empty. Nobody posted a ranked run, so nobody gets the bragging rights. [See the final boards](/#/leaderboards?season=138).",
    });
  });

  it("fits five of the longest generated names inside the Updates limits", () => {
    const longest = "Abcdef Ghijk Lmnop Qrstu Vwxyz"; // 5 words, 30 characters
    const entry = renderFinalResults(
      record({
        closedSeasonId: 99_999,
        leaders: fullBoards.map((leader) => ({
          ...leader,
          publicName: longest,
          score: 99_999_999,
        })),
      }),
      AT,
    );
    expectWithinLimits(entry);
  });

  it("opens the next season with its closing date", () => {
    const entry = renderOpeningBell(record(), AT);
    expectWithinLimits(entry);
    expect(entry).toMatchObject({
      id: "season-139-opening-bell",
      title: "Season 139 is open",
      body: "Season 139 is open. Surge, Higher / Lower, Trade, Survival, and Rain all start from zero and close January 4. Last season's #1s start there too. [Check the boards](/#/leaderboards).",
    });
    expect(
      renderOpeningBell(record({ openingSeasonEndsAt: undefined }), AT).body,
    ).toContain("all start from zero. Last season's");
  });
});

describe("display name escaping", () => {
  it.each([
    "**Bold** King",
    "[click](https://evil.example)",
    "`code` _under_ ~~gone~~",
    "![img](/x.png)",
    "www.evil.example",
    "<script>alert(1)</script>",
    "# Heading \\ back",
  ])("renders %s as literal text and nothing else", (name) => {
    const html = renderUpdateMarkdownHtml(`Surge: ${escapeDisplayName(name)}.`);
    expect(html).not.toMatch(/<(?:strong|em|code|a|img|script)\b/);
    expect(html).toContain(
      name
        .replace(/[<>]/g, "")
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;"),
    );
  });

  it("flattens line breaks and falls back when nothing printable is left", () => {
    expect(escapeDisplayName("Log\n\nKing")).toBe("Log King");
    expect(escapeDisplayName("<>\t")).toBe("Elixir Player");
  });

  it("cannot break the post out of its Markdown vocabulary", () => {
    const entry = renderFinalResults(
      record({
        leaders: [
          { mode: "surge", publicName: "[x](javascript:alert(1))", score: 1 },
        ],
      }),
      AT,
    );
    expect(renderUpdateMarkdownHtml(entry.body)).not.toContain(
      'href="javascript',
    );
    expect(renderUpdateMarkdownHtml(entry.body).match(/<a /g)).toHaveLength(1);
  });
});

// A faithful stand-in for the Updates store: the conditional put by id that
// Repository.publishUpdate does, including the 409 for changed copy.
function fakeStore(initial: SeasonPostsRecord[]) {
  const updates = new Map<string, UpdateEntry>();
  const records = new Map(
    initial.map((item) => [item.closedSeasonId, structuredClone(item)]),
  );
  const repository = {
    updates,
    records,
    pendingSeasonPosts: vi.fn(async () =>
      [...records.values()]
        .filter(
          (item) =>
            !item.posted["final-results"] || !item.posted["opening-bell"],
        )
        .map((item) => structuredClone(item)),
    ),
    publishUpdate: vi.fn(async (entry: UpdateEntry) => {
      const existing = updates.get(entry.id);
      if (!existing) {
        updates.set(entry.id, entry);
        return { entry, created: true };
      }
      if (JSON.stringify(existing) !== JSON.stringify(entry))
        throw new HttpError(
          409,
          "That update id already belongs to different copy.",
          "update_conflict",
        );
      return { entry: existing, created: false };
    }),
    markSeasonPostPublished: vi.fn(
      async (
        seasonId: number,
        kind: "final-results" | "opening-bell",
        at: string,
      ) => {
        const item = records.get(seasonId)!;
        item.posted[kind] ??= at;
      },
    ),
  };
  return repository;
}

describe("publishing owed season posts", () => {
  let clock: number;
  const now = () => new Date((clock += 1_000));
  beforeEach(() => {
    clock = Date.parse(AT);
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("publishes final results, then the opening bell, exactly once", async () => {
    const store = fakeStore([record()]);
    expect(await publishPendingSeasonPosts(store, now)).toBe(2);
    expect([...store.updates.keys()]).toEqual([
      "season-138-final-results",
      "season-139-opening-bell",
    ]);
    const [results, bell] = [...store.updates.values()];
    expect(Date.parse(bell!.publishedAt)).toBeGreaterThan(
      Date.parse(results!.publishedAt),
    );
    // Retried and duplicated war-clock jobs find nothing left to post.
    expect(await publishPendingSeasonPosts(store, now)).toBe(0);
    expect(await publishPendingSeasonPosts(store, now)).toBe(0);
    expect(store.updates.size).toBe(2);
    expect(store.publishUpdate).toHaveBeenCalledTimes(2);
  });

  it("treats a post that landed before its marker as posted, never a second copy", async () => {
    const store = fakeStore([record()]);
    // An earlier run wrote the Update and then died before marking it.
    store.markSeasonPostPublished.mockRejectedValueOnce(new Error("timeout"));
    expect(await publishPendingSeasonPosts(store, now)).toBe(1);
    expect(store.records.get(138)!.posted).toEqual({});
    // The retry renders a later timestamp, so the store refuses it as a
    // conflict on the same deterministic id: that means posted.
    expect(await publishPendingSeasonPosts(store, now)).toBe(1);
    expect(store.updates.size).toBe(2);
    expect(store.records.get(138)!.posted).toEqual({
      "final-results": expect.any(String),
      "opening-bell": expect.any(String),
    });
  });

  it("keeps a failed post owed, holds the opening bell behind it, and lands it on a later run", async () => {
    const store = fakeStore([record()]);
    store.publishUpdate.mockRejectedValueOnce(
      new Error("dynamodb unavailable"),
    );
    expect(await publishPendingSeasonPosts(store, now)).toBe(0);
    expect(store.updates.size).toBe(0);
    expect(console.error).toHaveBeenCalledWith({
      event: "season-post.failed",
      kind: "final-results",
      seasonId: 138,
      error: "Error",
    });
    expect(await publishPendingSeasonPosts(store, now)).toBe(2);
    expect([...store.updates.keys()]).toEqual([
      "season-138-final-results",
      "season-139-opening-bell",
    ]);
  });

  it("posts a late retry from the frozen closing boards", async () => {
    const store = fakeStore([record({ leaders: [fullBoards[0]!] })]);
    store.publishUpdate.mockRejectedValueOnce(
      new Error("dynamodb unavailable"),
    );
    await publishPendingSeasonPosts(store, now);
    await publishPendingSeasonPosts(store, now);
    expect(store.updates.get("season-138-final-results")?.body).toContain(
      "Surge: Log at **11.720s**. Nobody posted a ranked",
    );
  });

  it("never throws, even when the outbox cannot be read", async () => {
    const store = fakeStore([]);
    store.pendingSeasonPosts.mockRejectedValueOnce(new Error("throttled"));
    await expect(publishPendingSeasonPosts(store, now)).resolves.toBe(0);
  });

  it("finishes a season that only owes its opening bell", async () => {
    const store = fakeStore([record({ posted: { "final-results": AT } })]);
    expect(await publishPendingSeasonPosts(store, now)).toBe(1);
    expect([...store.updates.keys()]).toEqual(["season-139-opening-bell"]);
  });
});
