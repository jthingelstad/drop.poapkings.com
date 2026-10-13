// Sign-in redemption, the cross-context poll and session refresh. Since
// 2026-10-12 Drop signs in only with Elixir (routes/elixir-auth.ts): the
// callback mints the single-use credential redeemed here. Drop's own email
// codes and mailed links (POST /auth/request) are gone; guests still play
// without an account.

import { enqueueRefresh } from "../refresh-jobs.js";
import { HttpError } from "../errors.js";
import { json } from "../http.js";
import { emailSubject } from "../validation.js";
import {
  bodyOf,
  clientIpHash,
  issueSession,
  MAGIC_LINK_SECONDS,
  type RouteContext,
  sessionFor,
  sha256,
} from "./context.js";

// POST /auth/poll — pick up a session handed over by a redeem in another
// browser context (an Elixir sign-in that finished outside the tab that
// started it).
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

// POST /auth/redeem — burn the credential the Elixir callback minted, ensure
// the profile, and issue the session.
export async function redeemMagicLink({
  event,
  config,
  repository,
}: RouteContext) {
  const body = bodyOf(event);
  const nowSeconds = Math.floor(Date.now() / 1_000);
  if (typeof body.token !== "string" || body.token.length < 32)
    throw new HttpError(400, "A sign-in token is required.");
  const tokenHash = sha256(body.token);
  // Validate and complete the durable work before burning the single-use
  // credential: a transient failure mid-login used to consume it and strand
  // the player on "already used" with no way to retry.
  const magicLink = await repository.peekMagicLink(tokenHash, nowSeconds);
  // Only an Elixir-proven credential signs in. A mailed link minted before
  // email sign-in was removed is refused like a spent one.
  if (magicLink.source !== "elixir")
    throw new HttpError(
      401,
      "This login link is invalid, expired, or already used.",
      "invalid_magic_link",
    );
  const { email, pollId, recruiterSub } = magicLink;
  const sub = magicLink.sub ?? emailSubject(email);
  const login = await repository.ensureProfile(sub, email);
  // A sign-in with Elixir for an account that did not exist until this
  // moment: the connection and the Elixir pointer the callback learned are
  // applied now that the profile exists. A failure here fails the redemption
  // before the credential is spent, and the pending item stays for the
  // retry; it is removed only once the binding is decided.
  const pendingItem = await repository.peekPendingElixirLink(sub, nowSeconds);
  if (pendingItem) {
    const pending = pendingItem.link;
    const bound = await repository.bindElixirAccount(
      sub,
      pending.accountId,
      pending,
    );
    if (bound !== "bound")
      console.warn("Pending Elixir link was not applied", {
        requestId: event.requestContext.requestId,
        outcome: bound,
      });
    else if (pending.playerTag && login.profile.playerTag !== pending.playerTag)
      login.profile = await repository.updateProfile(sub, {
        playerTag: pending.playerTag,
      });
    await repository.clearPendingElixirLink(sub, pendingItem.pendingId);
  }
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
  await enqueueRefresh(config, {
    version: 1,
    type: "player-profile",
    sub: login.profile.sub,
    playerId: login.profile.playerId,
  });
  // Side channels are best-effort: a hiccup must not fail a login whose
  // credential is already spent. Drop keeps no mailing list of its own
  // (2026-10-12): Elixir's one list is Elixir's.
  try {
    await repository.putRecruiterInviteAlias(login.profile);
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
  await enqueueRefresh(config, {
    version: 1,
    type: "player-profile",
    sub: session.sub,
    playerId: profile.playerId,
  });
  return json(200, {
    session: issueSession(
      session.sub,
      config.sessionSecret,
      Math.floor(Date.now() / 1_000),
    ),
  });
}
