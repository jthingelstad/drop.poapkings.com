import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { GetQueueUrlCommand, SQSClient } from "@aws-sdk/client-sqs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { getBridgeConfig } from "./config.js";
import { publishBridgeStartedEvent } from "./discord.js";
import { pollOnce, runWorker } from "./worker.js";
import {
  publishBridgeHeartbeat,
  publishWarClockHeartbeat,
} from "./heartbeat.js";
import { relayWarClock } from "./war-clock.js";

// launchd relaunches a crashing bridge every ThrottleInterval (10s); without a
// guard the "online" Discord event fires on every lap and floods the channel.
const START_EVENT_COOLDOWN_MS = 10 * 60_000;

function startStampPath(): string {
  const logDir = join(homedir(), "Library", "Logs");
  return join(
    process.platform === "darwin" ? logDir : tmpdir(),
    "elixir-drop-cr-bridge.laststart",
  );
}

async function shouldAnnounceStart(now = Date.now()): Promise<boolean> {
  const path = startStampPath();
  let announce = true;
  try {
    const previous = Number(await readFile(path, "utf8"));
    announce =
      !Number.isFinite(previous) || now - previous >= START_EVENT_COOLDOWN_MS;
  } catch {
    // No stamp yet: first start on this host.
  }
  try {
    await writeFile(path, String(now), "utf8");
  } catch (error) {
    console.warn("CR bridge start stamp could not be written", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
  return announce;
}

async function main(): Promise<void> {
  const config = getBridgeConfig();
  const sqs = new SQSClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  const cloudWatch = new CloudWatchClient({
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
    publishHeartbeat: () => publishBridgeHeartbeat(cloudWatch),
    publishWarClock: async () => {
      const result = await relayWarClock(
        sqs,
        resultQueueUrl,
        config.warClockClanTag,
        config.crApiKey,
      );
      await publishWarClockHeartbeat(cloudWatch);
      console.info("CR war clock relayed", {
        crSeasonId: result.clock.crSeasonId,
        sectionIndex: result.clock.sectionIndex,
        periodIndex: result.clock.periodIndex,
        periodType: result.clock.periodType,
      });
    },
  };

  if (process.argv.includes("--once")) {
    await pollOnce(sqs, workerConfig);
  } else {
    const abort = new AbortController();
    process.once("SIGINT", () => abort.abort());
    process.once("SIGTERM", () => abort.abort());
    if (await shouldAnnounceStart())
      await publishBridgeStartedEvent(config.discordWebhookUrl, process.pid);
    else
      console.info("CR bridge start event suppressed (recent restart)", {
        cooldownMs: START_EVENT_COOLDOWN_MS,
      });
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
