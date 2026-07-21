import { createHmac } from "node:crypto";
import { SCORING_RULES_VERSION } from "./scoring.js";
import type {
  Correlation,
  EvidenceItem,
  GameMode,
  RunChallenge,
  RunTranscript,
} from "./types.js";

// Default retention: 180 days from completion (active season + human review
// window). Overridable via the constant so the retention decision lives in one
// place. DynamoDB's TTL sweeps the item after this.
export const EVIDENCE_TTL_SECONDS = 180 * 24 * 60 * 60;

// A short base64url HMAC. Same input + same pepper => same token, so the referee
// can correlate two runs to one source; but the token is not reversible to an IP
// or user-agent without the pepper, which never leaves the Lambda env.
function hmac(pepper: string, value: string): string {
  return createHmac("sha256", pepper)
    .update(value)
    .digest("base64url")
    .slice(0, 20);
}

// IPv6 addresses are case-insensitive; normalize to lower-case so the same host
// hashes identically regardless of how the client formatted it. IPv4 has no case.
function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  return trimmed.includes(":") ? trimmed.toLowerCase() : trimmed;
}

// The network prefix, hashed for same-network (not same-address) correlation:
// IPv4 -> zero the last octet (a.b.c.0, a /24); IPv6 -> first four hextets then
// "::" (a /64). Falls back to the whole value for anything unrecognized.
function ipSubnetPrefix(normalized: string): string {
  if (normalized.includes(":")) {
    const hextets = normalized.split(":").filter((part) => part.length > 0);
    return `${hextets.slice(0, 4).join(":")}::`;
  }
  const octets = normalized.split(".");
  if (octets.length === 4) return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
  return normalized;
}

// A coarse, dependency-free family string for grouping (e.g. "Chrome/macOS").
// Order matters: Edge/Opera UAs also contain "Chrome"/"Safari", and Chrome UAs
// contain "Safari", so the more specific token is tested first.
function uaFamily(userAgent: string): string {
  const os = /windows/i.test(userAgent)
    ? "Windows"
    : /iphone|ipad|ipod|ios/i.test(userAgent)
      ? "iOS"
      : /mac os x|macintosh/i.test(userAgent)
        ? "macOS"
        : /android/i.test(userAgent)
          ? "Android"
          : /linux/i.test(userAgent)
            ? "Linux"
            : "Other";
  const browser = /edg[ea]?\//i.test(userAgent)
    ? "Edge"
    : /opr\/|opera/i.test(userAgent)
      ? "Opera"
      : /firefox\/|fxios\//i.test(userAgent)
        ? "Firefox"
        : /chrome\/|crios\//i.test(userAgent)
          ? "Chrome"
          : /safari\//i.test(userAgent)
            ? "Safari"
            : "Other";
  return browser === "Other" && os === "Other" ? "Other" : `${browser}/${os}`;
}

// Derive the peppered correlation hashes for one request, in memory. The raw IP
// and user-agent are consumed here and discarded by the caller — they are never
// written to DynamoDB or returned in this object.
export function deriveCorrelation(
  pepper: string,
  ip: string | undefined,
  userAgent: string | undefined,
): Correlation {
  const correlation: Correlation = {};
  if (ip && ip.trim()) {
    const normalized = normalizeIp(ip);
    correlation.ipHash = hmac(pepper, normalized);
    correlation.ipSubnetHash = hmac(pepper, ipSubnetPrefix(normalized));
  }
  if (userAgent && userAgent.trim()) {
    correlation.uaHash = hmac(pepper, userAgent);
    correlation.uaFamily = uaFamily(userAgent);
  }
  return correlation;
}

export interface BuildEvidenceInput {
  sub: string;
  runId: string;
  mode: GameMode;
  seasonId: string;
  runType: "ranked" | "unscored" | "rejected";
  integrityOutcome: string;
  reviewSignals?: string[];
  score?: number;
  tiebreakMs?: number;
  challenge: RunChallenge;
  transcript: RunTranscript;
  startedAt: string;
  completedAt: string;
  wallElapsedMs: number;
  webVersion?: string;
  startCorrelation?: Correlation;
  completeCorrelation: Correlation;
  playerTag?: string;
}

// Shape one evidence item. Pure: no DynamoDB client here so it stays
// unit-testable; the repository does the write. Deliberately carries NO email.
export function buildEvidenceItem(input: BuildEvidenceInput): EvidenceItem {
  const expiresAt =
    Math.floor(new Date(input.completedAt).getTime() / 1_000) +
    EVIDENCE_TTL_SECONDS;
  return {
    pk: `PLAYER#${input.sub}`,
    sk: `EVIDENCE#${input.completedAt}#${input.runId}`,
    runId: input.runId,
    playerSub: input.sub,
    mode: input.mode,
    seasonId: input.seasonId,
    runType: input.runType,
    integrityOutcome: input.integrityOutcome,
    ...(input.reviewSignals?.length
      ? { reviewSignals: input.reviewSignals }
      : {}),
    ...(input.score !== undefined ? { score: input.score } : {}),
    ...(input.tiebreakMs !== undefined ? { tiebreakMs: input.tiebreakMs } : {}),
    challenge: input.challenge,
    transcript: input.transcript,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    wallElapsedMs: input.wallElapsedMs,
    scoringVersion: {
      rules: SCORING_RULES_VERSION,
      ...(input.webVersion ? { web: input.webVersion } : {}),
    },
    correlation: {
      complete: input.completeCorrelation,
      ...(input.startCorrelation ? { start: input.startCorrelation } : {}),
    },
    ...(input.playerTag ? { playerTag: input.playerTag } : {}),
    schemaVersion: "1",
    expiresAt,
  };
}
