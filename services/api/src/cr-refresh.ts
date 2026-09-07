import type { ClashRoyaleProfile } from "@elixir-drop/contracts";
import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import { fetchPlayerFromHub } from "./elixir-player.js";
import type { ElixirMcpFetch } from "./elixir-mcp.js";
import { Repository } from "./repository.js";
import type { CrProfileSnapshot } from "./types.js";

const PROFILE_FRESH_MS = 6 * 60 * 60 * 1_000;
const REFRESH_RETRY_MS = 2 * 60 * 1_000;

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
    // cards is deliberately absent: Drop reads it nowhere, and it was
    // the largest thing on this response.
    fetchedAt: snapshot.fetchedAt,
    refreshRequestedAt: snapshot.refreshRequestedAt,
  };
}

/**
 * Refresh one player's Clash Royale profile from the hub.
 *
 * The 6-hour claim is what keeps this cheap: a returning player inside
 * the window reads the stored snapshot and spends nothing. Only a stale
 * or missing one costs a live read.
 *
 * Failure is recorded rather than thrown. Enrichment is cosmetic, and
 * every caller is on a path — a login, a profile save — that must
 * succeed without it.
 */
export async function requestCrProfileRefresh(
  repository: Repository,
  config: Pick<Config, "elixirMcpBaseUrl" | "elixirMcpKey">,
  tag: string,
  now = new Date(),
  fetcher?: ElixirMcpFetch,
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

  if (!config.elixirMcpKey) {
    await repository.markCrRefreshUnavailable(
      tag,
      jobId,
      new Date().toISOString(),
    );
    return repository.getCrProfile(tag);
  }

  try {
    const player = await fetchPlayerFromHub(config, tag, fetcher);
    const fetchedAt = new Date().toISOString();
    await repository.saveCrProfileResult({
      tag,
      status: "ready",
      jobId,
      name: player.name,
      clan: player.clan,
      accountAge: player.accountAge,
      fetchedAt,
      refreshRequestedAt: requestedAt,
      updatedAt: fetchedAt,
    });
  } catch (error) {
    console.warn("Elixir MCP player enrichment failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    await repository.markCrRefreshUnavailable(
      tag,
      jobId,
      new Date().toISOString(),
    );
    throw error;
  }
  return repository.getCrProfile(tag);
}
