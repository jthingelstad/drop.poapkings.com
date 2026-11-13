import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQSEvent } from "aws-lambda";
import type { Repository } from "../src/repository.js";

const mocks = vi.hoisted(() => ({
  clock: vi.fn(),
  finalize: vi.fn(),
  getCrWarClock: vi.fn(),
  saveCrWarClock: vi.fn(),
  seasonPosts: vi.fn(),
}));
vi.mock("../src/season-posts.js", () => ({
  publishPendingSeasonPosts: mocks.seasonPosts,
}));
vi.mock("../src/season-clock.js", () => ({
  policyClock: mocks.clock,
}));
vi.mock("../src/podium.js", () => ({
  finalizePreviousSeasonIfNeeded: mocks.finalize,
}));
vi.mock("../src/repository.js", () => ({
  Repository: class {
    getCrWarClock = mocks.getCrWarClock;
    saveCrWarClock = mocks.saveCrWarClock;
  },
}));
import { processRefreshJob, refreshHandler } from "../src/refresh-worker.js";

// A job queued before 2026-11-13, when player-profile jobs were retired.
const retired = {
  version: 1,
  type: "player-profile",
  sub: "a".repeat(43),
  playerId: "generation-1",
} as const;
const repo = mocks as unknown as Repository;
const event = (jobs: unknown[]): SQSEvent =>
  ({
    Records: jobs.map((value, index) => ({
      messageId: String(index),
      body: JSON.stringify(value),
    })),
  }) as SQSEvent;

describe("durable refresh worker", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.TABLE_NAME = "test";
  });

  it("coalesces clock jobs that find an already fresh snapshot", async () => {
    mocks.getCrWarClock.mockResolvedValue({
      observedAt: new Date().toISOString(),
    });
    await processRefreshJob({ version: 1, type: "war-clock" }, repo);
    expect(mocks.clock).not.toHaveBeenCalled();
  });

  it("finalizes the old season before advancing the stored clock", async () => {
    const incoming = { crSeasonId: 136, observedAt: new Date().toISOString() };
    mocks.clock.mockReturnValue(incoming);
    await processRefreshJob({ version: 1, type: "war-clock" }, repo);
    expect(mocks.finalize).toHaveBeenCalledWith(repo, incoming);
    expect(mocks.saveCrWarClock).toHaveBeenCalledWith(incoming);
    expect(mocks.finalize.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.saveCrWarClock.mock.invocationCallOrder[0]!,
    );
  });

  it("publishes owed season posts after the clock is saved", async () => {
    mocks.clock.mockReturnValue({ crSeasonId: 139 });
    await processRefreshJob({ version: 1, type: "war-clock" }, repo);
    expect(mocks.seasonPosts).toHaveBeenCalledWith(repo);
    expect(mocks.saveCrWarClock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.seasonPosts.mock.invocationCallOrder[0]!,
    );
  });

  it("retries owed season posts on every clock job, even a coalesced one", async () => {
    mocks.getCrWarClock.mockResolvedValue({
      observedAt: new Date().toISOString(),
    });
    await processRefreshJob({ version: 1, type: "war-clock" }, repo);
    expect(mocks.clock).not.toHaveBeenCalled();
    expect(mocks.seasonPosts).toHaveBeenCalledTimes(1);
  });

  it("still tries owed season posts when finalization fails, and keeps the failure", async () => {
    mocks.clock.mockReturnValue({ crSeasonId: 139 });
    mocks.finalize.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      processRefreshJob({ version: 1, type: "war-clock" }, repo),
    ).rejects.toThrow("database unavailable");
    expect(mocks.seasonPosts).toHaveBeenCalledTimes(1);
    expect(mocks.saveCrWarClock).not.toHaveBeenCalled();
  });

  it("logs one saved-clock line for the staleness metric", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const incoming = { crSeasonId: 138, observedAt: new Date().toISOString() };
    mocks.clock.mockReturnValue(incoming);
    mocks.finalize.mockResolvedValue({ seasonId: 137 });
    await processRefreshJob({ version: 1, type: "war-clock" }, repo);
    expect(info).toHaveBeenCalledWith({
      event: "war-clock.saved",
      crSeasonId: 138,
      finalizedSeasonId: 137,
    });
    info.mockRestore();
  });

  it("logs no saved-clock line when the clock is not saved", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.clock.mockReturnValue({ crSeasonId: 138 });
    mocks.finalize.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      processRefreshJob({ version: 1, type: "war-clock" }, repo),
    ).rejects.toThrow("database unavailable");
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it("retains the old clock and retries failed finalization without consuming later FIFO work", async () => {
    mocks.clock.mockReturnValue({ crSeasonId: 136 });
    mocks.finalize.mockRejectedValueOnce(new Error("database unavailable"));
    const jobs = event([{ version: 1, type: "war-clock" }, retired]);
    expect(await refreshHandler(jobs)).toEqual({
      batchItemFailures: [{ itemIdentifier: "0" }, { itemIdentifier: "1" }],
    });
    expect(mocks.saveCrWarClock).not.toHaveBeenCalled();
    expect(
      await refreshHandler(event([{ version: 1, type: "war-clock" }])),
    ).toEqual({ batchItemFailures: [] });
    expect(mocks.saveCrWarClock).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed work without logging the payload", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(
      await refreshHandler(
        event([
          { version: 1, type: "war-clock-x", sub: "private@example.invalid" },
        ]),
      ),
    ).toEqual({ batchItemFailures: [{ itemIdentifier: "0" }] });
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "private@example.invalid",
    );
    log.mockRestore();
  });
});

it("drops a player-profile job queued before its retirement, reading nothing", async () => {
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Drop reads no profile from Elixir"));
  try {
    expect(await refreshHandler(event([retired]))).toEqual({
      batchItemFailures: [],
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.getCrWarClock).not.toHaveBeenCalled();
    expect(mocks.clock).not.toHaveBeenCalled();
  } finally {
    fetcher.mockRestore();
  }
});
