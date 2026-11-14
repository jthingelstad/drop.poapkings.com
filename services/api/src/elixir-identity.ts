// What Drop shows for a signed-in person, read from Elixir's `GET
// /api/v1/me` at sign-in (Jamie, 2026-11-14): the profile image the person
// set in Elixir, and the Clash Royale game name of the account's primary
// player, never an alt's. Drop's own Player Card and its made-up names are
// gone; guests still play and have no image.
//
// This file is the one place that knows the shape of `/me`, so a change on
// Elixir's side is an edit here and nowhere else. The shape (Elixir JSON API
// 5.1.0, `../elixir-mcp/packages/contracts/integration-api.openapi.json`):
//
//   data.avatar: { card_id, name, art_url, crop: { x, y, scale } } | null
//
// - `card_id` is a Clash Royale card id, the same id Drop's catalog uses.
// - `art_url` and `crop` are not used. Drop draws its own committed,
//   byte-for-byte copy of the card art with its own crop table, keyed by the
//   card id: the page loads nothing from Elixir (golden rules 2 and 5, and the
//   CSP stays as it is), the art works offline from the service worker's
//   cache, and the leaderboard projection needs no new field. Elixir's crop
//   table is Drop's 121 rows unchanged, so the circle is the same for every
//   card Drop holds. A card Drop's catalog lacks (Elixir has two more) is
//   stored as no picture, the Drop icon, until Drop's catalog has it.
// - `avatar` absent (an Elixir before 5.1.0) means Elixir does not say: Drop
//   keeps the picture it has. `null` means the person has none: Drop clears
//   it.
//
// The name is the game name of the `players[]` row that is the primary
// player (`is_primary`, relationship `primary`; `principal.subject` names the
// same player), whether or not Elixir has verified it, because that is how
// Elixir itself shows people. Whether it is verified (`claim_status:
// "verified"`) is a separate fact: Drop shows its verified mark beside the
// name only then (`account-tags.ts`), so an unverified name is never shown
// as proven. Names are display text from a game that allows almost anything,
// so they are tidied here (control and direction characters out, whitespace
// collapsed, length capped) and escaped at every output. Elixir stores them
// unchanged; this tidy is Drop's own.

import { favoriteCard } from "./cards.js";

export interface ElixirSelfPlayer {
  playerTag: string;
  name?: string;
  relationship: "primary" | "alt";
  isPrimary: boolean;
  verified: boolean;
  clanTag?: string;
  clanName?: string;
  clanRole?: string;
}

export interface ElixirIdentity {
  /** The primary player's game name, tidied, verified or not; undefined
   *  when the account has no primary player or its name tidies to nothing. */
  primaryName?: string;
  /** The profile image's card id. `undefined`: `/me` does not carry the
   *  field (keep what Drop has). `null`: no image, or a card Drop's catalog
   *  does not hold (clear it). */
  avatarCardId?: number | null;
}

export const GAME_NAME_MAX = 32;

/** Tidy a game name for storage. Escaping is the output's job, never this
 *  function's: the stored name is the text, not HTML. */
export function tidyGameName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const tidy = value
    .normalize("NFC")
    // Whitespace of any kind (tabs, newlines, line separators) is one space;
    // then control and format characters (bidi overrides, zero-width) go.
    .replace(/\s+/gu, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .trim();
  if (!tidy) return undefined;
  const chars = Array.from(tidy);
  return chars.length > GAME_NAME_MAX
    ? chars.slice(0, GAME_NAME_MAX).join("").trimEnd()
    : tidy;
}

function avatarFrom(data: Record<string, unknown>): number | null | undefined {
  if (!Object.hasOwn(data, "avatar")) return undefined;
  const avatar = data.avatar;
  if (avatar === null) return null;
  if (typeof avatar !== "object") return undefined;
  const card = favoriteCard((avatar as Record<string, unknown>).card_id);
  return card ? card.id : null;
}

/** Players that are the person (primary and alts) and what Drop shows for
 *  them, from `/me`'s `data`. Friends and watched players are not "you". */
export function parseElixirMe(data: Record<string, unknown>): {
  players: ElixirSelfPlayer[];
  identity: ElixirIdentity;
} {
  const rows = Array.isArray(data.players)
    ? (data.players as Record<string, unknown>[])
    : [];
  const players: ElixirSelfPlayer[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const relationship = row.relationship;
    if (relationship !== "primary" && relationship !== "alt") continue;
    if (typeof row.player_tag !== "string") continue;
    const name = tidyGameName(row.name);
    players.push({
      playerTag: row.player_tag,
      ...(name ? { name } : {}),
      relationship,
      isPrimary: row.is_primary === true,
      verified: row.claim_status === "verified",
      clanTag: typeof row.clan_tag === "string" ? row.clan_tag : undefined,
      clanName: typeof row.clan_name === "string" ? row.clan_name : undefined,
      clanRole: typeof row.clan_role === "string" ? row.clan_role : undefined,
    });
  }
  const primary = primaryPlayer(players);
  const avatarCardId = avatarFrom(data);
  return {
    players,
    identity: {
      ...(primary?.name ? { primaryName: primary.name } : {}),
      ...(avatarCardId !== undefined ? { avatarCardId } : {}),
    },
  };
}

/** The account's primary player: never an alt. */
export function primaryPlayer<
  T extends { relationship: "primary" | "alt"; isPrimary?: boolean },
>(players: readonly T[]): T | undefined {
  return (
    players.find((p) => p.isPrimary === true) ??
    players.find((p) => p.relationship === "primary")
  );
}
