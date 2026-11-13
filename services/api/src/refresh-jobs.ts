import { createHash } from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { Config } from "./config.js";
import { measure } from "./timings.js";

// The clock is the only refresh job since 2026-11-13; the player-profile
// job went when Drop stopped reading profiles outside sign-in.
export type RefreshJob = { version: 1; type: "war-clock" };

const queue = new SQSClient({ maxAttempts: 2 });

export async function enqueueRefresh(
  config: Pick<Config, "refreshQueueUrl">,
  job: RefreshJob,
): Promise<void> {
  if (!config.refreshQueueUrl) return;
  const body = JSON.stringify(job);
  const group = job.type;
  try {
    // FIFO coalesces identical work for five minutes and serializes each player
    // and the clock. Await durable acceptance, never the external refresh.
    await measure("refresh.enqueue", () =>
      queue.send(
        new SendMessageCommand({
          QueueUrl: config.refreshQueueUrl,
          MessageBody: body,
          MessageGroupId: group,
          MessageDeduplicationId: createHash("sha256")
            .update(body)
            .digest("hex"),
        }),
        { abortSignal: AbortSignal.timeout(750) },
      ),
    );
  } catch (error) {
    // A queue outage must not invalidate a session or hide cached public data.
    // The next ordinary request retries enqueueing; accepted jobs retry in SQS.
    console.warn("Refresh enqueue failed", {
      type: job.type,
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}
