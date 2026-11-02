import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../src/errors.js";
import type { UpdateEntry } from "../src/player-updates.js";
import type { Repository } from "../src/repository.js";
import type { SeasonPostsRecord } from "../src/season-posts.js";

const clock = vi.hoisted(() => vi.fn());
vi.mock("../src/elixir-war-clock.js", () => ({
  fetchWarClockFromHub: clock,
}));
import { processRefreshJob } from "../src/refresh-worker.js";

const config = {
  tableName: "test",
  elixirMcpBaseUrl: "https://hub.example",
  elixirMcpKey: "test-key",
};
const job = { version: 1, type: "war-clock" } as const;

// The real worker, finalization and season-posts code over an in-memory store
// that keeps the same conditional semantics as the DynamoDB repository.
function store() {
  let warClock: { crSeasonId: number; observedAt: string } | undefined = {
    crSeasonId: 138,
    observedAt: "2026-12-07T09:05:00.000Z",
  };
  const updates = new Map<string, UpdateEntry>();
  const outbox = new Map<number, SeasonPostsRecord>();
  let board = [{ rank: 1, score: 11_720, player: { publicName: "Log" } }];
  const repository = {
    updates,
    outbox,
    setBoard: (next: typeof board) => (board = next),
    clock: () => warClock,
    getCrWarClock: vi.fn(async () => warClock),
    saveCrWarClock: vi.fn(async (next: typeof warClock) => {
      warClock = next;
      return true;
    }),
    leaderboard: vi.fn(async (mode: string) => (mode === "surge" ? board : [])),
    seasonFinalists: vi.fn(async () => []),
    createSeasonPosts: vi.fn(async (record: SeasonPostsRecord) => {
      if (outbox.has(record.closedSeasonId)) return false;
      outbox.set(record.closedSeasonId, structuredClone(record));
      return true;
    }),
    pendingSeasonPosts: vi.fn(async () =>
      [...outbox.values()]
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
        throw new HttpError(409, "conflict", "update_conflict");
      return { entry: existing, created: false };
    }),
    markSeasonPostPublished: vi.fn(
      async (
        seasonId: number,
        kind: "final-results" | "opening-bell",
        at: string,
      ) => {
        outbox.get(seasonId)!.posted[kind] ??= at;
      },
    ),
  };
  return repository;
}

describe("season posts ride the war-clock job", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-12-07T10:05:00.000Z") });
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    clock.mockReset();
    clock.mockResolvedValue({
      crSeasonId: 139,
      observedAt: "2026-12-07T10:05:00.000Z",
      seasonEndsAt: "2027-01-04T10:00:00.000Z",
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("posts both season posts once across a retried and duplicated job", async () => {
    const repo = store();
    await processRefreshJob(job, config, repo as unknown as Repository);
    expect(repo.clock()?.crSeasonId).toBe(139);
    expect([...repo.updates.keys()]).toEqual([
      "season-138-final-results",
      "season-139-opening-bell",
    ]);

    // A duplicated job inside the freshness window, then the next hourly run.
    await processRefreshJob(job, config, repo as unknown as Repository);
    vi.setSystemTime(new Date("2026-12-07T11:05:00.000Z"));
    clock.mockResolvedValue({
      crSeasonId: 139,
      observedAt: "2026-12-07T11:05:00.000Z",
    });
    await processRefreshJob(job, config, repo as unknown as Repository);
    expect(repo.updates.size).toBe(2);
    expect(repo.publishUpdate).toHaveBeenCalledTimes(2);
  });

  it("saves the clock when posting fails and lands the posts on a later run from the closing board", async () => {
    const repo = store();
    repo.publishUpdate.mockRejectedValueOnce(new Error("throttled"));
    await expect(
      processRefreshJob(job, config, repo as unknown as Repository),
    ).resolves.toBeUndefined();
    expect(repo.clock()?.crSeasonId).toBe(139);
    expect(repo.updates.size).toBe(0);

    // The live board moves after the close; the post must not.
    repo.setBoard([{ rank: 1, score: 9_000, player: { publicName: "Late" } }]);
    vi.setSystemTime(new Date("2026-12-07T11:05:00.000Z"));
    clock.mockResolvedValue({
      crSeasonId: 139,
      observedAt: "2026-12-07T11:05:00.000Z",
    });
    await processRefreshJob(job, config, repo as unknown as Repository);
    const results = repo.updates.get("season-138-final-results");
    expect(results?.body).toContain("Surge: Log at **11.720s**.");
    expect(results?.body).not.toContain("Late");
    expect(results?.publishedAt).toBe("2026-12-07T11:05:00.000Z");
    expect(repo.updates.has("season-139-opening-bell")).toBe(true);
  });

  it("keeps the first closing snapshot when finalization is retried", async () => {
    const repo = store();
    repo.seasonFinalists.mockRejectedValueOnce(new Error("award failed"));
    repo.publishUpdate.mockRejectedValueOnce(new Error("throttled"));
    await expect(
      processRefreshJob(job, config, repo as unknown as Repository),
    ).rejects.toThrow("award failed");
    expect(repo.clock()?.crSeasonId).toBe(138);

    repo.setBoard([{ rank: 1, score: 9_000, player: { publicName: "Late" } }]);
    await processRefreshJob(job, config, repo as unknown as Repository);
    expect(repo.clock()?.crSeasonId).toBe(139);
    expect(repo.createSeasonPosts).toHaveBeenCalledTimes(2);
    expect(repo.updates.get("season-138-final-results")?.body).toContain(
      "Surge: Log at **11.720s**.",
    );
  });

  it("posts nothing when no season closed", async () => {
    const repo = store();
    clock.mockResolvedValue({
      crSeasonId: 138,
      observedAt: "2026-12-07T10:05:00.000Z",
    });
    await processRefreshJob(job, config, repo as unknown as Repository);
    expect(repo.createSeasonPosts).not.toHaveBeenCalled();
    expect(repo.updates.size).toBe(0);
  });
});
