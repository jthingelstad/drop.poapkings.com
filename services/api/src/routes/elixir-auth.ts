// Sign in with Elixir (2026-09-12). Drop keeps email-code sign-in as the
// always-available path; this is an addition, never a replacement.
//
// The identity problem, solved the one clean way: a Drop account IS an
// email (sub = sha256(email)), and Elixir proves the person's email with a
// code before any grant exists. With the account:email scope Elixir hands
// that address to Drop at /oauth/userinfo, so an Elixir sign-in resolves to
// exactly the Drop account a magic link would have. No merging, ever.
//
// The callback never issues a session itself. It mints a magic link that
// Elixir already proved and sends the browser to the existing redemption
// route, so the two paths Drop has already tested on phones do the rest:
// AuthRedeem (one tap, mail-scanner safe) and the /auth/poll handoff (the
// tab that started the flow gets the session even if iOS finished it in
// another browsing context).
//
// One exception to "the email decides": a browser that STARTED the flow
// while holding a Drop session is linking, not signing in. The outcome is
// attached to that account whatever email Elixir names, and the proven
// link is minted for that account's email. Jamie's decision, 2026-09-12.

import { randomBytes } from "node:crypto";
import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ELIXIR_RETURN_PATH } from "@elixir-drop/contracts";
import { ElixirOAuthClient, pkcePair, randomState } from "../elixir-oauth.js";
import type { ElixirFailure, ElixirSelfPlayer } from "../elixir-oauth.js";
import { enqueueRefresh } from "../refresh-jobs.js";
import { HttpError } from "../errors.js";
import { json } from "../http.js";
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
    fetch: fetchImpl,
  });
}

// POST /auth/elixir/start — mint the state and PKCE pair, remember where to
// land and whether this is a link, and hand the browser the URL to visit.
// The poll id works exactly as it does for a mailed link.
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
  const state = randomState();
  const { verifier, challenge } = pkcePair();
  const pollId = randomBytes(24).toString("base64url");
  const nowSeconds = Math.floor(Date.now() / 1_000);
  await repository.saveElixirLogin(state, {
    verifier,
    returnTo,
    pollId,
    linkSub: session?.sub,
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

  // Who, in order: a person (not an agent's grant), then the address.
  const person = await client.initialize(token);
  if (!person.ok) return failTo(config.appUrl, person.code);
  const who = await client.userinfo(token);
  if (!who.ok) return failTo(config.appUrl, who.code);

  let email: string;
  try {
    email = normalizeEmail(who.user.email);
  } catch {
    return failTo(config.appUrl, "email_unavailable");
  }
  // The account this sign-in belongs to: the browser's own when it was
  // already signed in (a link), else the one this email names.
  const sub = login.linkSub ?? emailSubject(email);
  const existing = await repository.getProfile(sub);
  const targetEmail = existing?.email ?? email;

  // Which players are theirs, and: if Drop already shows a tag that is not
  // on their Elixir account, add it there as an alt so it can be chosen
  // (Jamie, 2026-09-12). A refusal is recorded, never fatal.
  let players = await client.selfPlayers(token);
  if (!players.ok) return failTo(config.appUrl, players.code);
  let trackRefused: string | undefined;
  const dropTag = existing?.playerTag;
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

  // The link, written now for an existing account; a brand-new account gets
  // it at redemption (the profile does not exist yet), from the pending
  // login item the proven magic link points back at.
  const link = buildLink({
    accountId: who.user.sub,
    players: players.players,
    currentTag: existing?.playerTag,
    previous: existing?.elixir,
    trackRefused,
    now: new Date().toISOString(),
  });
  if (existing) {
    await repository.setElixirLink(sub, link);
    if (link.playerTag && link.playerTag !== existing.playerTag) {
      await repository.updateProfile(sub, { playerTag: link.playerTag });
      await enqueueRefresh(config, {
        version: 1,
        type: "player-profile",
        sub,
        playerId: existing.playerId,
      });
    }
  } else {
    await repository.savePendingElixirLink(
      sub,
      link,
      nowSeconds + LOGIN_SECONDS,
    );
  }

  // Hand off to the redemption route with a link Elixir already proved.
  const magicToken = randomBytes(32).toString("base64url");
  await repository.saveProvenMagicLink(
    sha256(magicToken),
    targetEmail,
    nowSeconds + MAGIC_LINK_SECONDS,
    login.pollId,
  );
  // Land on the picker when there is a choice to make or something to say;
  // otherwise where the person was going.
  const needsAttention =
    !link.playerTag || link.candidates.length > 1 || Boolean(trackRefused);
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

// DELETE /me/elixir — disconnect. The tag stays; the mark and the link go.
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
