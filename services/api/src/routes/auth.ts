import { randomBytes } from "node:crypto";
import {
  buttondownPlayerMetadata,
  enrollButtondownSubscriber,
  updateButtondownSubscriberMetadata,
} from "../buttondown.js";
import { loginWebhookPayload, publishDiscordEvent } from "../discord.js";
import { badRequest, HttpError } from "../errors.js";
import { json } from "../http.js";
import { sendMagicLink } from "../jmap.js";
import {
  emailSubject,
  normalizeEmail,
  normalizeGameReturnPath,
} from "../validation.js";
import {
  bodyOf,
  clientIpHash,
  issueSession,
  MAGIC_LINK_SECONDS,
  refreshedCrProfile,
  type RouteContext,
  sessionFor,
  sha256,
} from "./context.js";

// POST /auth/request — mail a single-use magic link.
export async function requestMagicLink({
  event,
  config,
  repository,
}: RouteContext) {
  const body = bodyOf(event);
  let email: string;
  try {
    email = normalizeEmail(body.email);
  } catch (error) {
    throw badRequest(error);
  }
  const returnTo = normalizeGameReturnPath(body.returnTo);
  const ip = event.requestContext.http.sourceIp || "unknown";
  await Promise.all([
    repository.useRateLimit("magic-email", emailSubject(email), 5, 60 * 60),
    repository.useRateLimit("magic-ip", sha256(ip), 20, 60 * 60),
    // A global hourly ceiling: distributed abuse across many IPs must not
    // turn the login mailer into a spam cannon that burns the domain's
    // sender reputation. Far above any honest beta hour.
    repository.useRateLimit("magic-global", "all", 200, 60 * 60),
  ]);

  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);
  // Secret handoff id, returned only to this client (never emailed). Lets a
  // waiting client — e.g. an installed PWA whose storage is isolated from the
  // browser that opens the emailed link — poll for its session.
  const pollId = randomBytes(24).toString("base64url");
  const expiresAt = Math.floor(Date.now() / 1_000) + MAGIC_LINK_SECONDS;
  await repository.saveMagicLink(tokenHash, email, expiresAt, pollId);
  try {
    await sendMagicLink({
      token: config.jmapToken,
      fromEmail: config.emailFrom,
      fromName: config.emailFromName,
      to: email,
      magicLink: `${config.appUrl}/#/auth?token=${encodeURIComponent(token)}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`,
      expiresMinutes: MAGIC_LINK_SECONDS / 60,
    });
  } catch (error) {
    await repository.deleteMagicLink(tokenHash);
    throw error;
  }
  return json(202, {
    ok: true,
    message: "If that address can receive mail, a login link is on its way.",
    pollId,
  });
}

// POST /auth/poll — pick up a session handed over by a redeem in another
// browser context.
export async function pollSession({ event, repository }: RouteContext) {
  const body = bodyOf(event);
  if (typeof body.pollId !== "string" || body.pollId.length < 16)
    throw new HttpError(400, "A poll id is required.");
  await Promise.all([
    repository.useRateLimit("poll-id", sha256(body.pollId), 120, 60 * 30),
    repository.useRateLimit("poll-ip", clientIpHash(event), 600, 60 * 30),
  ]);
  const session = await repository.takePollSession(
    body.pollId,
    Math.floor(Date.now() / 1_000),
  );
  return json(200, session ? { ready: true, session } : { ready: false });
}

// POST /auth/redeem — burn the link, ensure the profile, issue the session.
export async function redeemMagicLink({
  event,
  config,
  repository,
}: RouteContext) {
  const body = bodyOf(event);
  if (typeof body.token !== "string" || body.token.length < 32)
    throw new HttpError(400, "A login token is required.");
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const tokenHash = sha256(body.token);
  // Validate and complete the durable work before burning the single-use
  // link: a transient failure mid-login used to consume the link and strand
  // the player on "already used" with no way to retry.
  const { email, pollId } = await repository.peekMagicLink(
    tokenHash,
    nowSeconds,
  );
  const sub = emailSubject(email);
  const login = await repository.ensureProfile(sub, email);
  await repository.consumeMagicLink(tokenHash, nowSeconds);
  const session = issueSession(sub, config.sessionSecret, nowSeconds);
  // Hand the session to a client waiting on this request's poll id (e.g. the
  // installed PWA, when the link opened in a different browser). Best-effort:
  // a write hiccup must not fail a login whose link is already spent.
  if (pollId) {
    try {
      await repository.savePollSession(
        pollId,
        session,
        nowSeconds + MAGIC_LINK_SECONDS,
      );
    } catch (error) {
      console.warn("Poll-session handoff write failed", {
        requestId: event.requestContext.requestId,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
  console.info("Player login completed", {
    requestId: event.requestContext.requestId,
    playerId: login.profile.playerId,
    newPlayer: login.created,
  });
  // Side channels are best-effort: a Discord or CR hiccup must not fail a
  // login whose link is already spent.
  try {
    const crProfile = refreshedCrProfile(
      repository,
      config.crRequestQueueUrl,
      login.profile.playerTag,
    );
    await Promise.all([
      publishDiscordEvent(
        config.discordWebhookUrl,
        loginWebhookPayload({
          profile: login.profile,
          newPlayer: login.created,
        }),
      ),
      crProfile.then((snapshot) =>
        enrollButtondownSubscriber(
          {
            apiKey: config.buttondownApiKey,
            newsletterId: config.buttondownNewsletterId,
          },
          login.profile.email,
          buttondownPlayerMetadata(login.profile, snapshot),
        ),
      ),
    ]);
  } catch (error) {
    console.warn("Post-login side effects failed", {
      requestId: event.requestContext.requestId,
      error: error instanceof Error ? error.name : "unknown",
    });
  }
  return json(200, {
    session,
  });
}

// POST /auth/refresh — slide an active player's session forward.
export async function refreshSession({
  event,
  config,
  repository,
}: RouteContext) {
  const session = sessionFor(event, config.sessionSecret, true);
  // Sessions are stateless signed claims, so renewal is the one moment to
  // stop a deleted account from sliding forever on self-refreshing tokens.
  const profile = await repository.getProfile(session.sub);
  if (!profile)
    throw new HttpError(
      401,
      "Your session has expired. Sign in again.",
      "invalid_session",
    );
  // A renewed session is also the routine "player is back" signal: queue a
  // (six-hour-deduplicated) Clash Royale refresh so an active player's
  // linked profile keeps up without ever re-redeeming a magic link.
  const crProfile = await refreshedCrProfile(
    repository,
    config.crRequestQueueUrl,
    profile.playerTag,
  );
  await updateButtondownSubscriberMetadata(
    {
      apiKey: config.buttondownApiKey,
      newsletterId: config.buttondownNewsletterId,
    },
    profile.email,
    buttondownPlayerMetadata(profile, crProfile),
  );
  return json(200, {
    session: issueSession(
      session.sub,
      config.sessionSecret,
      Math.floor(Date.now() / 1_000),
    ),
  });
}
