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
import { isShareToken } from "../shares.js";
import { refereeReviewStatus } from "../referee-status.js";
import { publishTinylyticsEvent } from "../tinylytics.js";
import {
  emailSubject,
  normalizeEmail,
  normalizeGameReturnPath,
} from "../validation.js";
import {
  bodyOf,
  clientIp,
  clientIpHash,
  issueSession,
  MAGIC_LINK_SECONDS,
  refreshedCrProfile,
  type RouteContext,
  sessionFor,
  sha256,
} from "./context.js";
import { isPublishedRunReference } from "./published-shares.js";
import { isPublishedBadgeReference } from "./published-badges.js";

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
  const sub = emailSubject(email);
  const ip = clientIp(event, config.webOriginToken);
  await Promise.all([
    repository.useRateLimit("magic-email", sub, 5, 60 * 60),
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
  let recruiterSub: string | undefined;
  const recruiterToken =
    typeof body.recruiterToken === "string"
      ? body.recruiterToken.toUpperCase()
      : undefined;
  const recruiterShare =
    typeof body.recruiterShare === "object" && body.recruiterShare !== null
      ? (body.recruiterShare as Record<string, unknown>)
      : undefined;
  const publishedRunRecruiter = isPublishedRunReference(
    recruiterShare?.playerId,
    recruiterShare?.runId,
  )
    ? {
        playerId: recruiterShare.playerId,
        runId: recruiterShare.runId as string,
      }
    : undefined;
  const publishedBadgeRecruiter = isPublishedBadgeReference(
    recruiterShare?.playerId,
    recruiterShare?.badgeSlug,
    recruiterShare?.rungIndex,
  )
    ? {
        playerId: recruiterShare.playerId,
        slug: recruiterShare.badgeSlug as string,
        rungIndex: recruiterShare.rungIndex as number,
      }
    : undefined;
  if (
    isShareToken(recruiterToken) ||
    publishedRunRecruiter ||
    publishedBadgeRecruiter
  ) {
    try {
      const existingProfile = await repository.getProfile(sub);
      if (!existingProfile && isShareToken(recruiterToken)) {
        const share = await repository.getShare(recruiterToken);
        if (share && share.owner !== sub) recruiterSub = share.owner;
      } else if (!existingProfile && publishedRunRecruiter) {
        const share = await repository.getPublishedRunShare(
          publishedRunRecruiter.playerId,
          publishedRunRecruiter.runId,
        );
        const decision = share
          ? (await repository.refereeDecisions([share.runId])).get(share.runId)
          : undefined;
        if (
          share &&
          share.owner !== sub &&
          refereeReviewStatus(decision) !== "excluded"
        )
          recruiterSub = share.owner;
      } else if (!existingProfile && publishedBadgeRecruiter) {
        const share = await repository.getPublishedBadgeShare(
          publishedBadgeRecruiter.playerId,
          publishedBadgeRecruiter.slug,
          publishedBadgeRecruiter.rungIndex,
        );
        if (share && share.owner !== sub) recruiterSub = share.owner;
      }
    } catch (error) {
      // Attribution is optional. A share read must never keep a player from
      // receiving the login email they asked for.
      console.warn("Recruiter attribution lookup failed", {
        requestId: event.requestContext.requestId,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
  await repository.saveMagicLink(
    tokenHash,
    email,
    expiresAt,
    pollId,
    recruiterSub,
  );
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
  await publishTinylyticsEvent(
    {
      apiToken: config.tinylyticsApiToken,
      webOriginToken: config.webOriginToken,
    },
    event,
    {
      event: "account.login_requested",
      path: "/login",
    },
  );
  return json(202, {
    ok: true,
    message: "If that address can receive mail, a login link is on its way.",
    pollId,
  });
}

// POST /auth/poll — pick up a session handed over by a redeem in another
// browser context.
export async function pollSession({ event, config, repository }: RouteContext) {
  const body = bodyOf(event);
  if (typeof body.pollId !== "string" || body.pollId.length < 16)
    throw new HttpError(400, "A poll id is required.");
  await Promise.all([
    repository.useRateLimit("poll-id", sha256(body.pollId), 120, 60 * 30),
    repository.useRateLimit(
      "poll-ip",
      clientIpHash(event, config.webOriginToken),
      600,
      60 * 30,
    ),
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
  const { email, pollId, recruiterSub } = await repository.peekMagicLink(
    tokenHash,
    nowSeconds,
  );
  const sub = emailSubject(email);
  const login = await repository.ensureProfile(sub, email);
  if (recruiterSub) await repository.attachRecruiter(sub, recruiterSub);
  if (recruiterSub || login.profile.recruitedBy) {
    // Recruiter means creating a real account. The exact-once transaction may
    // safely retry if redemption was interrupted after profile creation, and
    // also settles attributed accounts created under the former first-game
    // rule. A counter write cannot strand the new player's login: /me retries
    // any uncredited attribution on their first ordinary account load.
    try {
      await repository.creditRecruiter(sub, new Date().toISOString());
    } catch (error) {
      console.warn("Recruiter account-creation credit failed", {
        requestId: event.requestContext.requestId,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
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
      publishTinylyticsEvent(
        {
          apiToken: config.tinylyticsApiToken,
          webOriginToken: config.webOriginToken,
        },
        event,
        {
          event: "account.login_completed",
          value: login.created ? "new" : "returning",
          path: "/login",
        },
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
