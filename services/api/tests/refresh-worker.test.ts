import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQSEvent } from "aws-lambda";
import type { Repository } from "../src/repository.js";

const mocks = vi.hoisted(() => ({
  clock: vi.fn(),
  finalize: vi.fn(),
  profile: vi.fn(),
  metadata: vi.fn(),
  getCrWarClock: vi.fn(),
  saveCrWarClock: vi.fn(),
  getProfile: vi.fn(),
  getProfileRefreshHash: vi.fn(),
  saveProfileRefreshHash: vi.fn(),
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
vi.mock("../src/buttondown.js", async (original) => ({
  ...(await original<typeof import("../src/buttondown.js")>()),
  updateButtondownSubscriberMetadata: mocks.metadata,
}));
vi.mock("../src/repository.js", () => ({
  Repository: class {
    getCrWarClock = mocks.getCrWarClock;
    saveCrWarClock = mocks.saveCrWarClock;
    getProfile = mocks.getProfile;
    getProfileRefreshHash = mocks.getProfileRefreshHash;
    saveProfileRefreshHash = mocks.saveProfileRefreshHash;
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
  appUrl: "https://drop.example",
  elixirMcpBaseUrl: "https://hub.example",
  elixirMcpKey: "test-key",
  warClockClanTag: "#ABC",
  buttondownApiKey: "test",
  buttondownNewsletterId: "test",
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
    process.env.APP_URL = config.appUrl;
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
      expect(mocks.metadata).not.toHaveBeenCalled();
    },
  );

  it("does not resend unchanged newsletter metadata", async () => {
    await processRefreshJob(job, config, repo);
    const hash = mocks.saveProfileRefreshHash.mock.calls[0]![2];
    mocks.getProfileRefreshHash.mockResolvedValue(hash);
    await processRefreshJob(job, config, repo);
    expect(mocks.metadata).toHaveBeenCalledTimes(1);
    expect(mocks.metadata).toHaveBeenCalledWith(
      expect.any(Object),
      player.email,
      expect.any(Object),
      undefined,
      true,
    );
  });

  it("does not mark a failed newsletter write as synchronized", async () => {
    mocks.metadata.mockRejectedValueOnce(new Error("network"));
    await expect(processRefreshJob(job, config, repo)).rejects.toThrow(
      "network",
    );
    expect(mocks.saveProfileRefreshHash).not.toHaveBeenCalled();
    await processRefreshJob(job, config, repo);
    expect(mocks.metadata).toHaveBeenCalledTimes(2);
    expect(mocks.saveProfileRefreshHash).toHaveBeenCalledTimes(1);
  });

  it("retries failed enrichment before updating newsletter metadata", async () => {
    mocks.profile.mockRejectedValueOnce(new Error("hub unavailable"));
    await expect(processRefreshJob(job, config, repo)).rejects.toThrow(
      "hub unavailable",
    );
    expect(mocks.metadata).not.toHaveBeenCalled();
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
