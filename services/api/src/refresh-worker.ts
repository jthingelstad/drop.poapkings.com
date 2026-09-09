import { rememberPlayerInCollection } from "./elixir-collection.js";
import { createHash } from "node:crypto";
import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { required, type Config } from "./config.js";
import { requestCrProfileRefresh } from "./cr-refresh.js";
import { fetchWarClockFromHub } from "./elixir-war-clock.js";
import { finalizePreviousSeasonIfNeeded } from "./podium.js";
import { Repository } from "./repository.js";
import {
  buttondownPlayerMetadata,
  updateButtondownSubscriberMetadata,
} from "./buttondown.js";
import type { RefreshJob } from "./refresh-jobs.js";
import { measure, withTimings } from "./timings.js";

type RefreshConfig = Pick<
  Config,
  | "tableName"
  | "appUrl"
  | "elixirMcpBaseUrl"
  | "elixirMcpKey"
  | "elixirMcpCollectionSlug"
  | "buttondownApiKey"
  | "buttondownNewsletterId"
>;

function parseJob(body: string): RefreshJob {
  const job = JSON.parse(body) as Partial<RefreshJob> | null;
  if (job?.version === 1 && job.type === "war-clock")
    return { version: 1, type: "war-clock" };
  if (
    job?.version === 1 &&
    job.type === "player-profile" &&
    typeof job.sub === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(job.sub) &&
    typeof job.playerId === "string" &&
    job.playerId.length > 0 &&
    job.playerId.length <= 100
  )
    return {
      version: 1,
      type: "player-profile",
      sub: job.sub,
      playerId: job.playerId,
    };
  throw new Error("Invalid refresh job");
}

export async function processRefreshJob(
  job: RefreshJob,
  config: RefreshConfig,
  repository: Repository,
): Promise<void> {
  if (job.type === "war-clock") {
    if (!config.elixirMcpKey) return;
    const stored = await repository.getCrWarClock();
    if (stored && Date.now() - Date.parse(stored.observedAt) < 5 * 60_000)
      return;
    const incoming = await fetchWarClockFromHub(config);
    // The queue serializes clock jobs. On timeout/failure, the old clock remains
    // until the idempotent awards finish on retry. Never lose the transition.
    await measure("season.finalize", () =>
      finalizePreviousSeasonIfNeeded(repository, incoming),
    );
    await repository.saveCrWarClock(incoming);
    return;
  }

  const profile = await repository.getProfile(job.sub);
  // Jobs carry an account generation, so a deleted/recreated account is untouched.
  if (!profile || profile.playerId !== job.playerId) return;
  await rememberPlayerInCollection(config, profile.playerTag);
  const snapshot = profile.playerTag
    ? await requestCrProfileRefresh(repository, config, profile.playerTag)
    : undefined;
  if (!config.buttondownApiKey || !config.buttondownNewsletterId) return;
  const metadata = buttondownPlayerMetadata(profile, config.appUrl, snapshot);
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        metadata,
        profileUpdatedAt: profile.updatedAt,
        crFetchedAt: snapshot?.fetchedAt,
      }),
    )
    .digest("hex");
  if ((await repository.getProfileRefreshHash(job.sub)) === hash) return;
  await measure("buttondown.metadata", () =>
    updateButtondownSubscriberMetadata(
      {
        apiKey: config.buttondownApiKey,
        newsletterId: config.buttondownNewsletterId,
      },
      profile.email,
      metadata,
      undefined,
      true,
    ),
  );
  await repository.saveProfileRefreshHash(job.sub, profile.playerId, hash);
}

export async function refreshHandler(
  event: SQSEvent,
): Promise<SQSBatchResponse> {
  const config: RefreshConfig = {
    tableName: required("TABLE_NAME"),
    appUrl: required("APP_URL").replace(/\/$/, ""),
    elixirMcpBaseUrl: required("ELIXIR_MCP_BASE_URL").replace(/\/$/, ""),
    elixirMcpKey:
      process.env.ELIXIR_INTEGRATION_KEY?.trim() ||
      process.env.ELIXIR_MCP_KEY?.trim() ||
      undefined,
    elixirMcpCollectionSlug:
      process.env.ELIXIR_MCP_COLLECTION_SLUG?.trim() || "elixir-drop",
    buttondownApiKey: process.env.BUTTONDOWN_API_KEY?.trim() || undefined,
    buttondownNewsletterId:
      process.env.BUTTONDOWN_NEWSLETTER_ID?.trim() || undefined,
  };
  const repository = new Repository(config.tableName);
  for (let index = 0; index < event.Records.length; index += 1) {
    const record = event.Records[index]!;
    try {
      const job = parseJob(record.body);
      await withTimings(`refresh.${job.type}`, () =>
        processRefreshJob(job, config, repository),
      );
    } catch (error) {
      console.error("Refresh job failed", {
        error: error instanceof Error ? error.name : "unknown",
      });
      // Preserve FIFO ordering even if a future mapping increases the batch size.
      return {
        batchItemFailures: event.Records.slice(index).map((item) => ({
          itemIdentifier: item.messageId,
        })),
      };
    }
  }
  return { batchItemFailures: [] };
}
