import { playerReference } from "@elixir-drop/contracts";

const DROP_PLAYER_TAG_PATTERN = /^P[0-9A-HJKMNP-TV-Z]{10}$/;

export function isRecruiterInviteReference(
  dropTag: unknown,
): dropTag is string {
  return (
    typeof dropTag === "string" &&
    DROP_PLAYER_TAG_PATTERN.test(dropTag.toUpperCase())
  );
}

export function recruiterInviteUrl(appUrl: string, playerId: string): string {
  return `${appUrl}/share/${dropPlayerTag(playerId).slice(1)}/invite`;
}

export function dropPlayerTag(playerId: string): string {
  return playerReference(playerId);
}
