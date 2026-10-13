// Sign in with Elixir (2026-09-12); since 2026-10-12 the only way to sign in
// to Drop (Jamie: "You can still play Drop without an account, but if you
// play it with an account it will be an Elixir account. We will drop the
// basic email only route."). Guests still play without one. Elixir's page
// signs a person in or creates their Elixir account, so a new Drop player
// starts there too.
//
// Which Drop account a sign-in opens, in order:
//   1. the pointer `ELIXIR#<Elixir account id>` written when a profile was
//      linked (or by the 2026-10-12 backfill), so a person whose Elixir
//      address differs from their Drop one lands on their own profile;
//   2. else the profile at sha256(the address Elixir proved), which is the
//      account Drop's old email codes opened (Elixir's email_hash is the
//      same sha256), and the pointer is written then;
//   3. else a new profile keyed the same way, with its pointer written at
//      redemption, when the profile exists.
// A pointer whose profile is gone is removed, never followed: no deleted
// account comes back and no other account is reached through it. A profile
// already bound to a different Elixir account still opens to the address it
// was made with (that address is the account), but its Elixir connection is
// left as it is.
//
// The callback never issues a session itself. It mints a single-use
// credential for the resolved account and sends the browser to the
// redemption route, so AuthRedeem (one tap) and the /auth/poll handoff (the
// tab that started the flow gets the session even if iOS finished it in
// another browsing context) do the rest.
//
// One exception to the resolution above: a browser that STARTED the flow
// while holding a Drop session is linking, not signing in. The outcome is
// attached to that account whatever email Elixir names (Jamie, 2026-09-12),
// unless the Elixir account already opens another Drop account or this one
// already belongs to another Elixir account; those are refused, never moved.

import { randomBytes } from "node:crypto";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ELIXIR_RETURN_PATH } from "@elixir-drop/contracts";
import { ElixirOAuthClient, pkcePair, randomState } from "../elixir-oauth.js";
import type { ElixirFailure, ElixirSelfPlayer } from "../elixir-oauth.js";
import { enqueueRefresh } from "../refresh-jobs.js";
import { HttpError } from "../errors.js";
import { json } from "../http.js";
import { isRecruiterInviteReference } from "../recruiter.js";
import { refereeReviewStatus } from "../referee-status.js";
import { isShareToken } from "../shares.js";
import type { ElixirCandidate, ElixirLink, PlayerProfile } from "../types.js";
import {
  emailSubject,
  normalizeAuthReturnPath,
  normalizeEmail,
  normalizePlayerTag,
} from "../validation.js";
import {
  bodyOf,
  clientIpHash,
  MAGIC_LINK_SECONDS,
  profileResponse,
  type RouteContext,
  sessionFor,
  sha256,
} from "./context.js";
import { isPublishedRunReference } from "./published-shares.js";
import { isPublishedBadgeReference } from "./published-badges.js";
import { isPublishedProfileReference } from "./published-profiles.js";

const LOGIN_SECONDS = 10 * 60;

function redirect(location: string): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 303,
    headers: { location, "cache-control": "no-store" },
    body: "",
  };
}

function callbackUri(appUrl: string): string {
  return `${appUrl}/api/auth/elixir/callback`;
}

export function elixirClientFor(
  config: RouteContext["config"],
  fetchImpl?: typeof fetch,
): ElixirOAuthClient {
  return new ElixirOAuthClient({
    issuer: config.elixirMcpBaseUrl,
    clientId: config.elixirOAuthClientId,
    clientSecret: config.elixirOAuthClientSecret,
    fetch: fetchImpl,
  });
}

// The owner of the attributed share a signed-out browser arrived through
// (Recruiter, AGENTS.md "Herald is result reach; Recruiter is account
// creation"). Resolved when the flow starts, while the browser still holds
// the reference; the callback credits it only to an account the sign-in
// creates, and never to the recruiter themselves. Optional: a failed read
// never stops a sign-in.
async function recruiterFor(
  body: Record<string, unknown>,
  repository: RouteContext["repository"],
): Promise<string | undefined> {
  const recruiterToken =
    typeof body.recruiterToken === "string"
      ? body.recruiterToken.toUpperCase()
      : undefined;
  const share =
    typeof body.recruiterShare === "object" && body.recruiterShare !== null
      ? (body.recruiterShare as Record<string, unknown>)
      : undefined;
  if (isShareToken(recruiterToken))
    return (await repository.getShare(recruiterToken))?.owner;
  if (isPublishedRunReference(share?.playerId, share?.runId)) {
    const published = await repository.getPublishedRunShare(
      share.playerId,
      share.runId as string,
    );
    if (!published) return undefined;
    const decision = (await repository.refereeDecisions([published.runId])).get(
      published.runId,
    );
    return refereeReviewStatus(decision) === "excluded"
      ? undefined
      : published.owner;
  }
  if (
    isPublishedBadgeReference(
      share?.playerId,
      share?.badgeSlug,
      share?.rungIndex,
    )
  )
    return (
      await repository.getPublishedBadgeShare(
        share.playerId,
        share.badgeSlug as string,
        share.rungIndex as number,
      )
    )?.owner;
  if (share?.profile === true && isPublishedProfileReference(share.playerId))
    return (await repository.getPublishedProfileShare(share.playerId))?.owner;
  if (share?.invite === true && isRecruiterInviteReference(share.dropPlayerTag))
    return (
      await repository.getRecruiterInvite(share.dropPlayerTag.toUpperCase())
    )?.sub;
  return undefined;
}

// POST /auth/elixir/start — mint the state and PKCE pair, remember where to
// land, whether this is a link, and any Recruiter attribution, and hand the
// browser the URL to visit.
export async function startElixirLogin(
  { event, config, repository }: RouteContext,
  client = elixirClientFor(config),
) {
  if (!client.configured)
    throw new HttpError(
      503,
      "Sign in with Elixir is not set up on this deployment yet.",
      "elixir_not_configured",
    );
  const body = bodyOf(event);
  const returnTo = normalizeAuthReturnPath(body.returnTo);
  const session = sessionFor(event, config.sessionSecret);
  await repository.useRateLimit(
    "elixir-start-ip",
    clientIpHash(event, config.webOriginToken),
    30,
    60 * 60,
  );
  let recruiterSub: string | undefined;
  if (!session) {
    try {
      recruiterSub = await recruiterFor(body, repository);
    } catch (error) {
      console.warn("Recruiter attribution lookup failed", {
        requestId: event.requestContext.requestId,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
  const state = randomState();
  const { verifier, challenge } = pkcePair();
  const pollId = randomBytes(24).toString("base64url");
  const nowSeconds = Math.floor(Date.now() / 1_000);
  await repository.saveElixirLogin(state, {
    verifier,
    returnTo,
    pollId,
    linkSub: session?.sub,
    ...(recruiterSub ? { recruiterSub } : {}),
    expiresAt: nowSeconds + LOGIN_SECONDS,
  });
  return json(200, {
    url: client.authorizationUrl({
      redirectUri: callbackUri(config.appUrl),
      state,
      codeChallenge: challenge,
    }),
    pollId,
    mode: session ? "link" : "sign-in",
  });
}

function failTo(
  appUrl: string,
  code: string,
): APIGatewayProxyStructuredResultV2 {
  return redirect(`${appUrl}/#/login?elixir=${encodeURIComponent(code)}`);
}

// GET /auth/elixir/callback — the browser is back from Elixir's consent.
export async function elixirCallback(
  { event, config, repository }: RouteContext,
  client = elixirClientFor(config),
) {
  const q = event.queryStringParameters ?? {};
  const nowSeconds = Math.floor(Date.now() / 1_000);
  if (!q.state || !q.code) return failTo(config.appUrl, "missing_code");
  if (q.iss && q.iss.replace(/\/$/, "") !== config.elixirMcpBaseUrl)
    return failTo(config.appUrl, "wrong_issuer");
  const login = await repository.takeElixirLogin(q.state, nowSeconds);
  if (!login) return failTo(config.appUrl, "login_expired");

  const exchanged = await client.exchange({
    code: q.code,
    codeVerifier: login.verifier,
    redirectUri: callbackUri(config.appUrl),
  });
  if (!exchanged.ok) return failTo(config.appUrl, exchanged.code);
  const token = exchanged.tokens.accessToken;

  // Who, in order: a person with their players (not an agent's grant),
  // then the address.
  let players = await client.selfPlayers(token);
  if (!players.ok) return failTo(config.appUrl, players.code);
  const who = await client.userinfo(token);
  if (!who.ok) return failTo(config.appUrl, who.code);

  let email: string;
  try {
    email = normalizeEmail(who.user.email);
  } catch {
    return failTo(config.appUrl, "email_unavailable");
  }
  const accountId = who.user.sub;

  // Which Drop account this is (see the header). Pointer first; a pointer
  // whose profile is gone is removed and never followed.
  let target: PlayerProfile | undefined;
  const pointed = await repository.getElixirIdentity(accountId);
  if (pointed) {
    target = await repository.getProfile(pointed);
    if (!target) await repository.releaseElixirIdentity(accountId, pointed);
  }
  if (login.linkSub) {
    const own = await repository.getProfile(login.linkSub);
    if (!own) return failTo(config.appUrl, "login_expired");
    if (target && target.sub !== own.sub)
      return failTo(config.appUrl, "elixir_account_in_use");
    if (own.elixirAccountId && own.elixirAccountId !== accountId)
      return failTo(config.appUrl, "elixir_account_mismatch");
    target = own;
  } else if (!target) {
    target = await repository.getProfile(emailSubject(email));
  }
  const sub = target?.sub ?? emailSubject(email);
  // A profile that already belongs to another Elixir account opens to its
  // own address, but this sign-in does not touch its connection.
  const bindable =
    !target?.elixirAccountId || target.elixirAccountId === accountId;

  // If Drop already shows a tag that is not on their Elixir account, add it
  // there as an alt so it can be chosen (Jamie, 2026-09-12). A refusal is
  // recorded, never fatal.
  let trackRefused: string | undefined;
  const dropTag = bindable ? target?.playerTag : undefined;
  if (dropTag && !players.players.some((p) => p.playerTag === dropTag)) {
    const tracked = await client.trackAlt(token, dropTag);
    if (tracked.ok) {
      const again = await client.selfPlayers(token);
      if (again.ok) players = again;
    } else {
      trackRefused = dropTag;
      console.warn("Elixir would not track the Drop tag", {
        requestId: event.requestContext.requestId,
        toolCode: "toolCode" in tracked ? tracked.toolCode : undefined,
      });
    }
  }

  // The link and the pointer, written now for an existing account; a
  // brand-new account gets both at redemption (the profile does not exist
  // yet), from the pending item the redemption reads back.
  const link = buildLink({
    accountId,
    players: players.players,
    currentTag: target?.playerTag,
    previous: target?.elixir,
    trackRefused,
    now: new Date().toISOString(),
  });
  if (target && bindable) {
    const bound = await repository.bindElixirAccount(sub, accountId, link);
    if (bound === "missing_profile")
      return failTo(config.appUrl, "login_expired");
    if (bound !== "bound") return failTo(config.appUrl, bound);
    if (link.playerTag && link.playerTag !== target.playerTag) {
      await repository.updateProfile(sub, { playerTag: link.playerTag });
      await enqueueRefresh(config, {
        version: 1,
        type: "player-profile",
        sub,
        playerId: target.playerId,
      });
    }
  } else if (!target) {
    await repository.savePendingElixirLink(
      sub,
      link,
      nowSeconds + LOGIN_SECONDS,
    );
  }

  // Hand off to the redemption route with a credential Elixir already
  // proved. Recruiter credit rides only on an account this creates.
  const recruiterSub =
    !target && login.recruiterSub && login.recruiterSub !== sub
      ? login.recruiterSub
      : undefined;
  const magicToken = randomBytes(32).toString("base64url");
  await repository.saveProvenMagicLink(sha256(magicToken), {
    sub,
    email: target?.email ?? email,
    expiresAt: nowSeconds + MAGIC_LINK_SECONDS,
    pollId: login.pollId,
    ...(recruiterSub ? { recruiterSub } : {}),
  });
  // Land on the picker when there is a choice to make or something to say;
  // otherwise where the person was going.
  const needsAttention =
    bindable &&
    (!link.playerTag || link.candidates.length > 1 || Boolean(trackRefused));
  const returnTo = needsAttention ? ELIXIR_RETURN_PATH : login.returnTo;
  return redirect(
    `${config.appUrl}/#/auth?token=${encodeURIComponent(magicToken)}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}&via=elixir`,
  );
}

// The Elixir connection from what Elixir said. Exported for the tests.
export function buildLink(input: {
  accountId: string;
  players: ElixirSelfPlayer[];
  currentTag?: string;
  previous?: ElixirLink;
  trackRefused?: string;
  now: string;
}): ElixirLink {
  const candidates: ElixirCandidate[] = input.players.map((p) => ({
    playerTag: p.playerTag,
    ...(p.name ? { name: p.name } : {}),
    relationship: p.relationship,
    verified: p.verified,
    ...(p.clanTag ? { clanTag: p.clanTag } : {}),
  }));
  // Keep the previous choice if it is still theirs; else the Drop tag if it
  // is now among their players; else a lone player chooses itself; else
  // the person chooses.
  const still = (tag?: string) =>
    tag ? candidates.find((c) => c.playerTag === tag) : undefined;
  const chosen =
    still(input.previous?.playerTag) ??
    still(input.currentTag) ??
    (candidates.length === 1 ? candidates[0] : undefined);
  return {
    accountId: input.accountId,
    linkedAt: input.previous?.linkedAt ?? input.now,
    checkedAt: input.now,
    ...(chosen
      ? {
          playerTag: chosen.playerTag,
          ...(chosen.name ? { playerName: chosen.name } : {}),
        }
      : {}),
    verified: Boolean(chosen?.verified),
    ...(chosen?.verified
      ? {
          verifiedAt:
            input.previous?.playerTag === chosen.playerTag &&
            input.previous.verified &&
            input.previous.verifiedAt
              ? input.previous.verifiedAt
              : input.now,
        }
      : {}),
    candidates,
    ...(input.trackRefused ? { trackRefused: input.trackRefused } : {}),
  };
}

// POST /me/elixir/select — choose which of your Elixir players Drop shows.
// Only a candidate from the last Elixir sign-in can be chosen; the choice
// becomes Drop's playerTag through the ordinary tag-save path.
export async function selectElixirPlayer({
  event,
  config,
  repository,
}: RouteContext) {
  const session = sessionFor(event, config.sessionSecret, true);
  const body = bodyOf(event);
  let tag: string | undefined;
  try {
    tag = normalizePlayerTag(body.playerTag);
  } catch {
    tag = undefined;
  }
  if (!tag) throw new HttpError(400, "Choose one of your Elixir players.");
  const profile = await repository.getProfile(session.sub);
  if (!profile?.elixir)
    throw new HttpError(
      409,
      "Sign in with Elixir first, then choose a player.",
      "elixir_not_connected",
    );
  const chosen = profile.elixir.candidates.find((c) => c.playerTag === tag);
  if (!chosen)
    throw new HttpError(
      403,
      "That player is not one of yours on Elixir. Sign in with Elixir again to refresh the list.",
      "not_your_player",
    );
  const now = new Date().toISOString();
  const link: ElixirLink = {
    ...profile.elixir,
    playerTag: chosen.playerTag,
    ...(chosen.name ? { playerName: chosen.name } : {}),
    verified: chosen.verified,
    ...(chosen.verified
      ? {
          verifiedAt:
            profile.elixir.playerTag === chosen.playerTag &&
            profile.elixir.verifiedAt
              ? profile.elixir.verifiedAt
              : now,
        }
      : {}),
  };
  await repository.setElixirLink(session.sub, link);
  let updated: PlayerProfile = { ...profile, elixir: link };
  if (profile.playerTag !== chosen.playerTag) {
    updated = await repository.updateProfile(session.sub, {
      playerTag: chosen.playerTag,
    });
    await enqueueRefresh(config, {
      version: 1,
      type: "player-profile",
      sub: session.sub,
      playerId: profile.playerId,
    });
  }
  const crProfile = updated.playerTag
    ? await repository.getCrProfile(updated.playerTag)
    : undefined;
  const rankedAccess = await repository.rankedAccess(profile.playerId);
  return json(200, {
    player: profileResponse(
      { ...updated, elixir: link, elixirVerified: link.verified },
      crProfile,
      rankedAccess,
    ),
  });
}

// DELETE /me/elixir — clear the connection's display: the tag stays; the
// mark and the player list go. The account's Elixir identity (the pointer
// and `elixirAccountId`) stays, because a Drop account is an Elixir account
// (2026-10-12); the next sign-in with Elixir writes the connection again.
export async function disconnectElixir({
  event,
  config,
  repository,
}: RouteContext) {
  const session = sessionFor(event, config.sessionSecret, true);
  const profile = await repository.clearElixirLink(session.sub);
  const crProfile = profile.playerTag
    ? await repository.getCrProfile(profile.playerTag)
    : undefined;
  const rankedAccess = await repository.rankedAccess(profile.playerId);
  return json(200, {
    player: profileResponse(profile, crProfile, rankedAccess),
  });
}

export type { ElixirFailure };
