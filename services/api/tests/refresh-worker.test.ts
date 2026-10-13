import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQSEvent } from "aws-lambda";
import type { Repository } from "../src/repository.js";

const mocks = vi.hoisted(() => ({
  clock: vi.fn(),
  finalize: vi.fn(),
  profile: vi.fn(),
  getCrWarClock: vi.fn(),
  saveCrWarClock: vi.fn(),
  getProfile: vi.fn(),
}));
vi.mock("../src/elixir-war-clock.js", () => ({
  fetchWarClockFromHub: mocks.clock,
}));
vi.mock("../src/podium.js", () => ({
  finalizePreviousSeasonIfNeeded: mocks.finalize,
}));
vi.mock("../src/cr-refresh.js", () => ({
  requestCrProfileRefresh: mocks.profile,
}));
vi.mock("../src/repository.js", () => ({
  Repository: class {
    getCrWarClock = mocks.getCrWarClock;
    saveCrWarClock = mocks.saveCrWarClock;
    getProfile = mocks.getProfile;
  },
}));
import { processRefreshJob, refreshHandler } from "../src/refresh-worker.js";

const sub = "a".repeat(43);
const job = {
  version: 1,
  type: "player-profile",
  sub,
  playerId: "generation-1",
} as const;
const config = {
  tableName: "test",
  elixirMcpBaseUrl: "https://hub.example",
  elixirMcpKey: "test-key",
};
const repo = mocks as unknown as Repository;
const player = {
  sub,
  playerId: job.playerId,
  email: "private@example.invalid",
  playerTag: "#2PYQ0",
};
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
    mocks.getProfile.mockResolvedValue(player);
    mocks.profile.mockResolvedValue({
      status: "ready",
      clan: { tag: "#ABC", name: "Clan" },
    });
    process.env.TABLE_NAME = "test";
    process.env.ELIXIR_MCP_BASE_URL = config.elixirMcpBaseUrl;
    process.env.ELIXIR_MCP_KEY = config.elixirMcpKey;
  });

  it("coalesces clock jobs that find an already fresh snapshot", async () => {
    mocks.getCrWarClock.mockResolvedValue({
      observedAt: new Date().toISOString(),
    });
    await processRefreshJob({ version: 1, type: "war-clock" }, config, repo);
    expect(mocks.clock).not.toHaveBeenCalled();
  });

  it("finalizes the old season before advancing the stored clock", async () => {
    const incoming = { crSeasonId: 136, observedAt: new Date().toISOString() };
    mocks.clock.mockResolvedValue(incoming);
    await processRefreshJob({ version: 1, type: "war-clock" }, config, repo);
    expect(mocks.finalize).toHaveBeenCalledWith(repo, incoming);
    expect(mocks.saveCrWarClock).toHaveBeenCalledWith(incoming);
    expect(mocks.finalize.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.saveCrWarClock.mock.invocationCallOrder[0]!,
    );
  });

  it("retains the old clock and retries failed finalization without consuming later FIFO work", async () => {
    mocks.clock.mockResolvedValue({ crSeasonId: 136 });
    mocks.finalize.mockRejectedValueOnce(new Error("database unavailable"));
    const jobs = event([{ version: 1, type: "war-clock" }, job]);
    expect(await refreshHandler(jobs)).toEqual({
      batchItemFailures: [{ itemIdentifier: "0" }, { itemIdentifier: "1" }],
    });
    expect(mocks.saveCrWarClock).not.toHaveBeenCalled();
    expect(mocks.getProfile).not.toHaveBeenCalled();
    expect(
      await refreshHandler(event([{ version: 1, type: "war-clock" }])),
    ).toEqual({ batchItemFailures: [] });
    expect(mocks.saveCrWarClock).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, { ...player, playerId: "replacement" }])(
    "ignores deleted or recreated accounts",
    async (profile) => {
      mocks.getProfile.mockResolvedValue(profile);
      await processRefreshJob(job, config, repo);
      expect(mocks.profile).not.toHaveBeenCalled();
    },
  );

  it("refreshes a tagged player's Clash Royale snapshot", async () => {
    await processRefreshJob(job, config, repo);
    expect(mocks.profile).toHaveBeenCalledTimes(1);
    expect(mocks.profile).toHaveBeenCalledWith(repo, config, player.playerTag);
  });

  it("has nothing to refresh for a player without a tag", async () => {
    mocks.getProfile.mockResolvedValue({ ...player, playerTag: undefined });
    await processRefreshJob(job, config, repo);
    expect(mocks.profile).not.toHaveBeenCalled();
  });

  it("surfaces failed enrichment so the queue retries it", async () => {
    mocks.profile.mockRejectedValueOnce(new Error("hub unavailable"));
    await expect(processRefreshJob(job, config, repo)).rejects.toThrow(
      "hub unavailable",
    );
  });

  it("rejects malformed work without logging the payload", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(
      await refreshHandler(event([{ ...job, sub: "private@example.invalid" }])),
    ).toEqual({ batchItemFailures: [{ itemIdentifier: "0" }] });
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "private@example.invalid",
    );
    log.mockRestore();
  });
});

it("processes an existing queued profile job without collection enrollment", async () => {
  mocks.getProfile.mockResolvedValue(player);
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("collection enrollment is retired"));
  try {
    expect(await refreshHandler(event([job]))).toEqual({
      batchItemFailures: [],
    });
    expect(mocks.profile).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      player.playerTag,
    );
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    fetcher.mockRestore();
  }
});
