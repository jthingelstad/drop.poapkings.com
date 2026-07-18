import { GetQueueUrlCommand, SQSClient } from "@aws-sdk/client-sqs";
import { getBridgeConfig } from "./config.js";
import { pollOnce, runWorker } from "./worker.js";

async function main(): Promise<void> {
  const config = getBridgeConfig();
  const sqs = new SQSClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  async function queueUrl(name: string): Promise<string> {
    const result = await sqs.send(new GetQueueUrlCommand({ QueueName: name }));
    if (!result.QueueUrl) throw new Error(`Queue ${name} has no URL`);
    return result.QueueUrl;
  }

  const [requestQueueUrl, resultQueueUrl] = await Promise.all([
    queueUrl(config.requestQueueName),
    queueUrl(config.resultQueueName),
  ]);
  const workerConfig = {
    crApiKey: config.crApiKey,
    discordWebhookUrl: config.discordWebhookUrl,
    requestQueueUrl,
    resultQueueUrl,
  };

  if (process.argv.includes("--once")) {
    await pollOnce(sqs, workerConfig);
  } else {
    const abort = new AbortController();
    process.once("SIGINT", () => abort.abort());
    process.once("SIGTERM", () => abort.abort());
    console.info("Elixir Drop CR bridge started", {
      region: config.region,
      requestQueue: config.requestQueueName,
      resultQueue: config.resultQueueName,
    });
    await runWorker(sqs, workerConfig, abort.signal);
  }
}

void main().catch((error: unknown) => {
  console.error("Elixir Drop CR bridge could not start", {
    error: error instanceof Error ? error.message : "Unknown error",
  });
  process.exitCode = 1;
});
