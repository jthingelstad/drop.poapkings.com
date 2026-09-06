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
 * Best effort by design. A login or a profile save must never fail
 * because the hub is unreachable; the next login re-adds the tag, and
 * the periodic sync catches anything that slipped.
 */
export async function rememberPlayerInCollection(
  config: Config,
  playerTag: string | undefined,
  fetcher?: ElixirMcpFetch,
): Promise<void> {
  if (!playerTag || !config.elixirMcpKey) return;
  try {
    await addPlayerToCollection(
      { baseUrl: config.elixirMcpBaseUrl, token: config.elixirMcpKey },
      config.elixirMcpCollectionSlug,
      [playerTag],
      fetcher,
    );
  } catch (error) {
    console.warn("Elixir MCP collection add failed", {
      collection: config.elixirMcpCollectionSlug,
      // The tag is public game data; the error text may carry hub detail.
      playerTag,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
