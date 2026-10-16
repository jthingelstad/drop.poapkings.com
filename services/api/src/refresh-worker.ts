import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { required, type Config } from "./config.js";
import { requestCrProfileRefresh } from "./cr-refresh.js";
import { loadRuntimeSecrets } from "./runtime-secrets.js";
import { fetchWarClockFromHub } from "./elixir-war-clock.js";
import { finalizePreviousSeasonIfNeeded } from "./podium.js";
import { Repository } from "./repository.js";
import type { RefreshJob } from "./refresh-jobs.js";
import { measure, withTimings } from "./timings.js";

type RefreshConfig = Pick<
  Config,
  "tableName" | "elixirMcpBaseUrl" | "elixirMcpKey"
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
  if (!profile || profile.playerId !== job.playerId || !profile.playerTag)
    return;
  await requestCrProfileRefresh(repository, config, profile.playerTag);
}

export async function refreshHandler(
  event: SQSEvent,
): Promise<SQSBatchResponse> {
  await loadRuntimeSecrets();
  const config: RefreshConfig = {
    tableName: required("TABLE_NAME"),
    elixirMcpBaseUrl: required("ELIXIR_MCP_BASE_URL").replace(/\/$/, ""),
    elixirMcpKey:
      process.env.ELIXIR_INTEGRATION_KEY?.trim() ||
      process.env.ELIXIR_MCP_KEY?.trim() ||
      undefined,
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
