import type { ClashRoyaleProfile } from "@elixir-drop/contracts";
import type { ElixirCandidate } from "./types.js";
import type { Repository } from "./repository.js";
import type { CrProfileSnapshot } from "./types.js";

/** What a player sees of a Clash Royale profile. Drop learns a player's name
 * and clan only from Elixir's sign-in read (2026-11-13: Drop talks to Elixir
 * only to sign people in), so anything but a `ready` snapshot answers
 * `unavailable`: not read yet, sign in with Elixir again. Nothing polls for
 * it and nothing fetches it in the background. */
export function publicCrProfile(
  tag: string,
  snapshot: CrProfileSnapshot | undefined,
): ClashRoyaleProfile {
  if (snapshot?.status !== "ready") return { tag, status: "unavailable" };
  return {
    tag,
    status: "ready",
    name: snapshot.name,
    clan: snapshot.clan,
    fetchedAt: snapshot.fetchedAt,
  };
}

/** The snapshot for one of the person's own players, from the same
 * `GET /api/v1/me` answer that proved they are theirs. A clan needs both its
 * tag and its name; Elixir's read has no badge id. */
export function crSnapshotFromElixir(
  candidate: ElixirCandidate,
  readAt: string,
): CrProfileSnapshot | undefined {
  if (!candidate.name) return undefined;
  return {
    tag: candidate.playerTag,
    status: "ready",
    name: candidate.name,
    ...(candidate.clanTag && candidate.clanName
      ? {
          clan: {
            tag: candidate.clanTag,
            name: candidate.clanName,
            ...(candidate.clanRole ? { role: candidate.clanRole } : {}),
          },
        }
      : {}),
    fetchedAt: readAt,
    updatedAt: readAt,
  };
}

/** Store the chosen player's name and clan. Cosmetic: a failed write is
 * logged and never fails a sign-in or a player choice. */
export async function recordCrProfileFromElixir(
  repository: Pick<Repository, "saveCrProfileFromElixir">,
  candidate: ElixirCandidate | undefined,
  readAt: string,
): Promise<void> {
  const snapshot = candidate && crSnapshotFromElixir(candidate, readAt);
  if (!snapshot) return;
  try {
    await repository.saveCrProfileFromElixir(snapshot);
  } catch (error) {
    console.warn("CR profile snapshot write failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}
