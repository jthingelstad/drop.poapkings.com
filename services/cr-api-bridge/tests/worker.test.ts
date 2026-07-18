import { describe, expect, it, vi } from "vitest";
import { runWorker } from "../src/worker.js";

describe("CR bridge worker", () => {
  it("publishes the war clock immediately when the bridge starts", async () => {
    const abort = new AbortController();
    const publishWarClock = vi.fn(async () => abort.abort());

    await runWorker(
      { send: vi.fn() } as never,
      {
        crApiKey: "test-key",
        requestQueueUrl: "https://sqs.example/requests",
        resultQueueUrl: "https://sqs.example/results",
        publishWarClock,
      },
      abort.signal,
    );

    expect(publishWarClock).toHaveBeenCalledOnce();
  });
});
