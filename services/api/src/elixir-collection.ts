/**
 * Keeping the Elixir Drop player collection current.
 *
 * Every Drop player who has saved a Clash Royale tag belongs in the hub
 * collection, because membership is what makes Elixir MCP record them.
 * That recording is the point: it is how a player's real battles become
 * comparable with how they do in the learning games.
 *
 * Two things follow from Drop's own design and shape this module.
 *
 * The tag is OPTIONAL and stays out of setup, so most accounts have
 * nothing to add and this is a no-op for them. And the tag is
 * UNVERIFIED, so a member of this collection is a tag somebody typed,
 * not a proven identity. It is public game data either way, but do not
 * read the collection as "these people play Drop".
 */

import { addPlayerToCollection, type ElixirMcpFetch } from "./elixir-mcp.js";
import type { Config } from "./config.js";

/**
 * Called by the durable refresh worker. Errors propagate for queue retry;
 * login and profile save only enqueue, and reconciliation repairs missed work.
 */
export async function rememberPlayerInCollection(
  config: Pick<
    Config,
    "elixirMcpBaseUrl" | "elixirMcpKey" | "elixirMcpCollectionSlug"
  >,
  playerTag: string | undefined,
  fetcher?: ElixirMcpFetch,
): Promise<void> {
  if (!playerTag || !config.elixirMcpKey) return;
  await addPlayerToCollection(
    { baseUrl: config.elixirMcpBaseUrl, token: config.elixirMcpKey },
    config.elixirMcpCollectionSlug,
    [playerTag],
    fetcher,
  );
}
