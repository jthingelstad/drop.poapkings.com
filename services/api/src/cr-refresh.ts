import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type {
  ClashRoyaleProfile,
  CrPlayerRefreshRequest,
  GameMode,
} from "@elixir-drop/contracts";
import { randomUUID } from "node:crypto";
import { Repository } from "./repository.js";
import type { CrProfileSnapshot } from "./types.js";

const PROFILE_FRESH_MS = 6 * 60 * 60 * 1_000;
const REFRESH_RETRY_MS = 2 * 60 * 1_000;

const PLAYER_COLLECTION_MODES = new Set<GameMode>([
  "surge",
  "practice",
  "identify",
  "higher-lower",
  "blitz",
  "survival",
]);

const sqs = new SQSClient({});

export function usesPlayerCollection(mode: GameMode): boolean {
  return PLAYER_COLLECTION_MODES.has(mode);
}

export function publicCrProfile(
  tag: string,
  snapshot: CrProfileSnapshot | undefined,
): ClashRoyaleProfile {
  if (!snapshot) return { tag, status: "pending" };
  return {
    tag,
    status: snapshot.status,
    name: snapshot.name,
    clan: snapshot.clan,
    accountAge: snapshot.accountAge,
    cards: snapshot.cards,
    fetchedAt: snapshot.fetchedAt,
    refreshRequestedAt: snapshot.refreshRequestedAt,
  };
}

export async function requestCrProfileRefresh(
  repository: Repository,
  queueUrl: string,
  tag: string,
  now = new Date(),
): Promise<CrProfileSnapshot | undefined> {
  const requestedAt = now.toISOString();
  const jobId = randomUUID();
  const claimed = await repository.claimCrRefresh(
    tag,
    jobId,
    requestedAt,
    new Date(now.getTime() - PROFILE_FRESH_MS).toISOString(),
    new Date(now.getTime() - REFRESH_RETRY_MS).toISOString(),
  );
  if (!claimed) return repository.getCrProfile(tag);

  const message: CrPlayerRefreshRequest = {
    version: 1,
    type: "refresh-player",
    jobId,
    playerTag: tag,
    requestedAt,
  };
  try {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(message),
      }),
    );
  } catch (error) {
    await repository.markCrRefreshUnavailable(
      tag,
      jobId,
      new Date().toISOString(),
    );
    throw error;
  }
  return repository.getCrProfile(tag);
}
