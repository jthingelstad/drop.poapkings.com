import { randomInt } from "node:crypto";
import { HttpError } from "../errors.js";
import { isGameMode } from "../games.js";
import { json } from "../http.js";
import { deriveCorrelation } from "../referee-evidence.js";
import { createChallenge } from "../scoring.js";
import { signToken } from "../signing.js";
import {
  bodyOf,
  clientIp,
  clientIpHash,
  type RouteContext,
  sessionFor,
} from "./context.js";

export const RUN_SECONDS = 60 * 60;
export const PRACTICE_RUN_SECONDS = 24 * 60 * 60;
// The run token stays verifiable well past run.expiresAt so a late completion
// reaches the explicit 410 run_expired branch instead of dying in verifyToken
// as a generic 401 (which the web app treats as session loss).
export const RUN_TOKEN_GRACE_SECONDS = 24 * 60 * 60;

// POST /runs/start — deal a signed challenge for a signed-in or guest player.
export async function startRun({ event, config, repository }: RouteContext) {
  const body = bodyOf(event);
  if (!isGameMode(body.mode))
    throw new HttpError(400, "Choose a valid game mode.");
  // Rate-limit per IP FIRST, before any auth branch, so a signed-out (guest)
  // caller is covered exactly like a signed-in one.
  await repository.useRateLimit(
    "run-start",
    clientIpHash(event, config.webOriginToken),
    300,
    60 * 60,
  );
  // The session is optional: a signed-in player gets the ranked flow; a
  // signed-out visitor gets a scored-but-never-recorded guest run.
  const session = sessionFor(event, config.sessionSecret, false);
  // Every game uses the complete canonical catalog. Linked Clash Royale card
  // data and learning history stay on the profile for future features but do
  // not influence challenge selection. Guests are dealt the same challenge.
  const challenge = createChallenge(body.mode, randomInt);
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const runSeconds =
    body.mode === "practice" ? PRACTICE_RUN_SECONDS : RUN_SECONDS;
  // "guest" is a sentinel owner that can never collide with a real sub: real
  // subs are base64url SHA-256 email hashes, never the literal string.
  const owner = session?.sub ?? "guest";
  const isGuest = !session;
  if (session) {
    const profile = await repository.getProfile(session.sub);
    if (!profile?.favoriteCardId || !profile.publicName)
      throw new HttpError(
        409,
        "Choose a favorite card and player name before starting a game.",
        "profile_setup_required",
      );
    if (
      body.mode !== "practice" &&
      (await repository.rankedAccess(profile.playerId)) === "restricted"
    )
      throw new HttpError(
        403,
        "Ranked access is restricted. You can still use Practice and request a review from the Fair Play page.",
        "ranked_access_restricted",
      );
  }
  // Practice is true practice: signed-in runs record to the player's history
  // and Trophy Road but never write a leaderboard entry. Guest runs are never
  // ranked and never recorded at all.
  const ranked = !isGuest && body.mode !== "practice";
  // Derive the peppered start-time correlation hashes and discard the raw
  // IP/user-agent. Done for every run (guest included — it is only two hashes)
  // so completion evidence can compare start vs complete. The raw values are
  // never stored.
  const startCorrelation = deriveCorrelation(
    config.telemetryPepper,
    clientIp(event, config.webOriginToken),
    event.headers["user-agent"],
  );
  const run = await repository.createRun(
    owner,
    body.mode,
    challenge,
    nowSeconds + runSeconds,
    ranked,
    isGuest,
    startCorrelation,
  );
  const runToken = signToken(
    {
      type: "run",
      runId: run.runId,
      owner,
      mode: body.mode,
      ...(isGuest ? { guest: true } : {}),
      iat: nowSeconds,
      exp: nowSeconds + runSeconds + RUN_TOKEN_GRACE_SECONDS,
    },
    config.sessionSecret,
  );
  return json(201, {
    runId: run.runId,
    runToken,
    mode: run.mode,
    challenge: run.challenge,
    ranked,
    ...(isGuest ? { guest: true } : {}),
    expiresAt: new Date((nowSeconds + runSeconds) * 1_000).toISOString(),
  });
}
