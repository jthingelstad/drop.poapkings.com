import { createHash } from "node:crypto";
import { dropPlayerTag, recruiterInviteUrl } from "./recruiter.js";
import type { CrProfileSnapshot, PlayerProfile } from "./types.js";

export interface ButtondownConfig {
  apiKey?: string;
  newsletterId?: string;
}

type ButtondownFetch = (
  input: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number }>;

export interface ButtondownSubscriberMetadata {
  playerTag?: string;
  dropPlayerTag: string;
  recruiterUrl: string;
  // undefined preserves unknown existing clan data; null clears a known absence.
  clanTag?: string | null;
  clanName?: string | null;
  totalGames: number;
}

function headers(config: Required<ButtondownConfig>): Record<string, string> {
  return {
    Authorization: `Token ${config.apiKey}`,
    "Buttondown-Context": config.newsletterId,
    "Content-Type": "application/json",
  };
}

function configured(
  config: ButtondownConfig,
): Required<ButtondownConfig> | undefined {
  if (!config.apiKey || !config.newsletterId) return undefined;
  return config as Required<ButtondownConfig>;
}

export function buttondownPlayerMetadata(
  profile: Pick<PlayerProfile, "playerId" | "playerTag" | "totalGames">,
  appUrl: string,
  crProfile?: Pick<CrProfileSnapshot, "status" | "clan">,
  clearUnknownClan = false,
): ButtondownSubscriberMetadata {
  const clan = !profile.playerTag
    ? null
    : crProfile?.status === "ready"
      ? (crProfile.clan ?? null)
      : clearUnknownClan
        ? null
        : undefined;
  return {
    playerTag: profile.playerTag,
    dropPlayerTag: dropPlayerTag(profile.playerId),
    recruiterUrl: recruiterInviteUrl(appUrl, profile.playerId),
    ...(clan !== undefined
      ? {
          clanTag: clan?.tag ?? null,
          clanName: clan?.name ?? null,
        }
      : {}),
    totalGames: profile.totalGames,
  };
}

export function buttondownSubscriberMetadataBody(
  metadata: ButtondownSubscriberMetadata,
) {
  return {
    source: "elixir-drop-magic-link",
    player_tag: metadata.playerTag ?? null,
    drop_player_tag: metadata.dropPlayerTag,
    recruiter_url: metadata.recruiterUrl,
    ...(metadata.clanTag !== undefined ? { clan_tag: metadata.clanTag } : {}),
    ...(metadata.clanName !== undefined
      ? { clan_name: metadata.clanName }
      : {}),
    total_games: metadata.totalGames,
  };
}

export async function updateButtondownSubscriberMetadata(
  config: ButtondownConfig,
  email: string,
  metadata: ButtondownSubscriberMetadata,
  fetcher: ButtondownFetch = fetch,
): Promise<void> {
  const active = configured(config);
  if (!active) return;
  try {
    const response = await fetcher(
      `https://api.buttondown.com/v1/subscribers/${encodeURIComponent(email)}`,
      {
        method: "PATCH",
        headers: headers(active),
        body: JSON.stringify({
          metadata: buttondownSubscriberMetadataBody(metadata),
        }),
        signal: AbortSignal.timeout(3_000),
      },
    );
    if (response.ok) return;
    console.warn(
      `Buttondown subscriber metadata update failed with HTTP ${response.status}.`,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.name : "UnknownError";
    console.warn(
      `Buttondown subscriber metadata update failed with ${reason}.`,
    );
  }
}

export async function enrollButtondownSubscriber(
  config: ButtondownConfig,
  email: string,
  metadata: ButtondownSubscriberMetadata,
  fetcher: ButtondownFetch = fetch,
): Promise<void> {
  const active = configured(config);
  if (!active) return;
  try {
    const response = await fetcher(
      "https://api.buttondown.com/v1/subscribers",
      {
        method: "POST",
        headers: {
          ...headers(active),
          "X-Idempotency-Key": `elixir-drop-login-${createHash("sha256").update(email).digest("hex")}`,
        },
        body: JSON.stringify({
          email_address: email,
          type: "regular",
          metadata: buttondownSubscriberMetadataBody(metadata),
        }),
        signal: AbortSignal.timeout(3_000),
      },
    );
    if (response.ok) return;
    // Buttondown returns 400 for an existing address. Update only its metadata:
    // never overwrite the subscription type, so an unsubscribed or suppressed
    // player stays that way.
    if (response.status === 400) {
      await updateButtondownSubscriberMetadata(
        active,
        email,
        metadata,
        fetcher,
      );
      return;
    }
    console.warn(
      `Buttondown subscriber enrollment failed with HTTP ${response.status}.`,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.name : "UnknownError";
    console.warn(`Buttondown subscriber enrollment failed with ${reason}.`);
  }
}

export async function deleteButtondownSubscriber(
  config: ButtondownConfig,
  email: string,
  fetcher: ButtondownFetch = fetch,
): Promise<void> {
  const active = configured(config);
  if (!active) return;
  try {
    const response = await fetcher(
      `https://api.buttondown.com/v1/subscribers/${encodeURIComponent(email)}`,
      {
        method: "DELETE",
        headers: headers(active),
        signal: AbortSignal.timeout(3_000),
      },
    );
    if (response.ok || response.status === 404) return;
    console.warn(
      `Buttondown subscriber deletion failed with HTTP ${response.status}.`,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.name : "UnknownError";
    console.warn(`Buttondown subscriber deletion failed with ${reason}.`);
  }
}
