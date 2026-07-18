import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from "@aws-sdk/client-sqs";
import { fetchPlayer } from "./clash-royale.js";
import { publishPlayerPulledEvent } from "./discord.js";
import { parseRefreshRequest } from "./messages.js";

export interface WorkerConfig {
  crApiKey: string;
  discordWebhookUrl?: string;
  requestQueueUrl: string;
  resultQueueUrl: string;
}

function retryDelay(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timeout = setTimeout(finish, 5_000);
    signal.addEventListener("abort", finish, { once: true });
  });
}

export async function pollOnce(
  sqs: SQSClient,
  config: WorkerConfig,
): Promise<boolean> {
  const response = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: config.requestQueueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20,
      VisibilityTimeout: 60,
    }),
  );
  const message = response.Messages?.[0];
  if (!message?.Body || !message.ReceiptHandle) return false;

  const request = parseRefreshRequest(JSON.parse(message.Body) as unknown);
  const startedAt = Date.now();
  const result = await fetchPlayer(request, config.crApiKey);
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: config.resultQueueUrl,
      MessageBody: JSON.stringify(result),
    }),
  );
  await sqs.send(
    new DeleteMessageCommand({
      QueueUrl: config.requestQueueUrl,
      ReceiptHandle: message.ReceiptHandle,
    }),
  );
  await publishPlayerPulledEvent(
    config.discordWebhookUrl,
    result,
    Date.now() - startedAt,
  );
  console.info("CR player refresh completed", {
    jobId: request.jobId,
    playerTag: request.playerTag,
    outcome: result.outcome,
    cardCount: result.outcome === "success" ? result.player.cards.length : 0,
    durationMs: Date.now() - startedAt,
  });
  return true;
}

export async function runWorker(
  sqs: SQSClient,
  config: WorkerConfig,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    try {
      await pollOnce(sqs, config);
    } catch (error) {
      console.error("CR bridge poll failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      await retryDelay(signal);
    }
  }
}
