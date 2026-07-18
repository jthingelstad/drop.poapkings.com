import type { CrPlayerRefreshRequest } from "@elixir-drop/contracts";

const TAG_PATTERN = /^#[0289PYLQGRJCUV]{3,15}$/;

export function parseRefreshRequest(value: unknown): CrPlayerRefreshRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Refresh request must be an object");
  const source = value as Record<string, unknown>;
  if (source.version !== 1 || source.type !== "refresh-player")
    throw new Error("Unsupported refresh request");
  if (
    typeof source.jobId !== "string" ||
    !source.jobId ||
    source.jobId.length > 100
  )
    throw new Error("Refresh request job ID is invalid");
  if (
    typeof source.playerTag !== "string" ||
    !TAG_PATTERN.test(source.playerTag)
  )
    throw new Error("Refresh request player tag is invalid");
  if (
    typeof source.requestedAt !== "string" ||
    !Number.isFinite(Date.parse(source.requestedAt))
  )
    throw new Error("Refresh request timestamp is invalid");
  return {
    version: 1,
    type: "refresh-player",
    jobId: source.jobId,
    playerTag: source.playerTag,
    requestedAt: source.requestedAt,
  };
}
