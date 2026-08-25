// The existing production population was measured immediately before the
// First Drop rollout. Those accounts predate the durable allocation marker, so
// their registration timestamps are the immutable legacy boundary. New claims
// start at 26 and are serialized through SYSTEM#FIRST_DROP.
export const FIRST_DROP_LIMIT = 100;
export const FIRST_DROP_LEGACY_COUNT = 25;
export const FIRST_DROP_LEGACY_CUTOFF = "2026-08-17T01:12:31.012Z";

export function hasFirstDropBadge(profile: {
  createdAt?: string;
  firstDrop?: boolean;
}): boolean {
  if (profile.firstDrop === true) return true;
  if (!profile.createdAt) return false;
  const createdAt = Date.parse(profile.createdAt);
  const cutoff = Date.parse(FIRST_DROP_LEGACY_CUTOFF);
  return Number.isFinite(createdAt) && createdAt <= cutoff;
}
