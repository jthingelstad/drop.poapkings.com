import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config.js";
import type { Repository } from "../src/repository.js";
const send = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-sqs", async (original) => ({
  ...(await original<typeof import("@aws-sdk/client-sqs")>()),
  SQSClient: class {
    send = send;
  },
}));
import { enqueueRefresh } from "../src/refresh-jobs.js";
import { currentWarClock } from "../src/routes/context.js";

describe("request-side refresh scheduling", () => {
  beforeEach(() => {
    send.mockReset();
  });
  it("uses stable FIFO deduplication and a bounded queue deadline", async () => {
    const job = { version: 1, type: "war-clock" } as const;
    await enqueueRefresh({ refreshQueueUrl: "test" }, job);
    await enqueueRefresh({ refreshQueueUrl: "test" }, job);
    expect(send.mock.calls[0]![0].input).toEqual(send.mock.calls[1]![0].input);
    expect(send.mock.calls[0]![0].input.MessageGroupId).toBe("war-clock");
    expect(send.mock.calls[0]![1].abortSignal).toBeInstanceOf(AbortSignal);
  });
  it("returns cached clock data even when the queue is unavailable", async () => {
    const stored = { observedAt: "2026-01-01T00:00:00Z", crSeasonId: 134 };
    const repo = {
      getCrWarClock: vi.fn(async () => stored),
    } as unknown as Repository;
    send.mockRejectedValue(new Error("queue unavailable"));
    expect(
      await currentWarClock(repo, {
        refreshQueueUrl: "test",
        elixirMcpKey: "test",
      } as Config),
    ).toBe(stored);
    expect(send).toHaveBeenCalledOnce();
  });
  it("leaves fresh clocks alone and schedules missing clocks without blocking on MCP", async () => {
    const getCrWarClock = vi
      .fn()
      .mockResolvedValueOnce({ observedAt: new Date().toISOString() })
      .mockResolvedValueOnce(undefined);
    const repo = { getCrWarClock } as unknown as Repository;
    const config = { refreshQueueUrl: "test", elixirMcpKey: "test" } as Config;
    await currentWarClock(repo, config);
    expect(send).not.toHaveBeenCalled();
    expect(await currentWarClock(repo, config)).toBeUndefined();
    expect(send).toHaveBeenCalledOnce();
  });
});
