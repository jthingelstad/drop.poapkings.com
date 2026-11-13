import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { required, type Config } from "./config.js";
import { finalizePreviousSeasonIfNeeded } from "./podium.js";
import { Repository } from "./repository.js";
import { publishPendingSeasonPosts } from "./season-posts.js";
import { policyClock } from "./season-clock.js";
import type { RefreshJob } from "./refresh-jobs.js";
import { measure, withTimings } from "./timings.js";

type RefreshConfig = Pick<Config, "tableName">;

// `player-profile` jobs were retired on 2026-11-13: Drop reads a player's
// name and clan only at Sign in with Elixir. One still on the queue from
// before the deploy is acknowledged and dropped, never retried.
const RETIRED_JOB_TYPES = new Set(["player-profile"]);

function parseJob(body: string): RefreshJob | "retired" {
  const job = JSON.parse(body) as { version?: unknown; type?: unknown } | null;
  if (job?.version === 1 && job.type === "war-clock")
    return { version: 1, type: "war-clock" };
  if (job?.version === 1 && RETIRED_JOB_TYPES.has(job.type as string))
    return "retired";
  throw new Error("Invalid refresh job");
}

async function advanceWarClock(repository: Repository): Promise<void> {
  const stored = await repository.getCrWarClock();
  if (stored && Date.now() - Date.parse(stored.observedAt) < 5 * 60_000) return;
  // Drop's own calendar (season-clock.ts): no request leaves Drop for it.
  const incoming = policyClock();
  // The queue serializes clock jobs. On timeout/failure, the old clock remains
  // until the idempotent awards finish on retry. Never lose the transition.
  const finalized = await measure("season.finalize", () =>
    finalizePreviousSeasonIfNeeded(repository, incoming),
  );
  await repository.saveCrWarClock(incoming);
  // One line per saved clock. The hourly schedule (infra WarClockSchedule)
  // makes these steady, so a metric filter can tell a stalled clock apart.
  console.info({
    event: "war-clock.saved",
    crSeasonId: incoming.crSeasonId,
    ...(finalized ? { finalizedSeasonId: finalized.seasonId } : {}),
  });
}

export async function processRefreshJob(
  _job: RefreshJob,
  repository: Repository,
): Promise<void> {
  try {
    await advanceWarClock(repository);
  } finally {
    // Owed season posts publish after every clock job, whatever the clock
    // did, so a failed post retries on the next hourly run. This never
    // throws, and nothing it does can undo finalization or the saved clock.
    await measure("season.posts", () => publishPendingSeasonPosts(repository));
  }
}

// The worker holds no credential: the clock is computed and the table is
// reached through the function's role, so it reads no runtime secret.
export async function refreshHandler(
  event: SQSEvent,
): Promise<SQSBatchResponse> {
  const config: RefreshConfig = { tableName: required("TABLE_NAME") };
  const repository = new Repository(config.tableName);
  for (let index = 0; index < event.Records.length; index += 1) {
    const record = event.Records[index]!;
    try {
      const job = parseJob(record.body);
      if (job === "retired") continue;
      await withTimings(`refresh.${job.type}`, () =>
        processRefreshJob(job, repository),
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
