import { describe, expect, it, vi } from "vitest";
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from "@aws-sdk/client-sqs";
import { pollOnce, runWorker } from "../src/worker.js";

const playerBody = {
  name: "CR Player",
  cards: [{ id: 26000000, name: "Knight" }],
};

function refreshMessage(jobId: string) {
  return {
    Body: JSON.stringify({
      version: 1,
      type: "refresh-player",
      jobId,
      playerTag: "#2PYQ0",
      requestedAt: "2026-07-18T12:00:00.000Z",
    }),
    ReceiptHandle: `receipt-${jobId}`,
  };
}

function stubSqs(message: { Body: string; ReceiptHandle: string }) {
  const sent: Array<InstanceType<typeof SendMessageCommand>> = [];
  const deleted: Array<InstanceType<typeof DeleteMessageCommand>> = [];
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof ReceiveMessageCommand)
      return { Messages: [message] };
    if (command instanceof SendMessageCommand) {
      sent.push(command);
      return {};
    }
    if (command instanceof DeleteMessageCommand) {
      deleted.push(command);
      return {};
    }
    return {};
  });
  return { send, sent, deleted };
}

describe("CR bridge worker", () => {
  it("fetches, sends the result, deletes the request, and drops duplicates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(playerBody), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const message = refreshMessage("job-dedupe");
    const sqs = stubSqs(message);
    const config = {
      crApiKey: "test-key",
      requestQueueUrl: "https://sqs.example/requests",
      resultQueueUrl: "https://sqs.example/results",
    };

    expect(await pollOnce(sqs as never, config)).toBe(true);
    expect(sqs.sent).toHaveLength(1);
    expect(JSON.parse(String(sqs.sent[0]?.input.MessageBody))).toMatchObject({
      jobId: "job-dedupe",
      outcome: "success",
    });
    expect(sqs.deleted).toHaveLength(1);

    // A redelivered duplicate (expired visibility, failed delete) must be
    // deleted without a second CR fetch or result message.
    expect(await pollOnce(sqs as never, config)).toBe(true);
    expect(sqs.sent).toHaveLength(1);
    expect(sqs.deleted).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

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
