import { createHash, randomBytes, randomInt } from "node:crypto";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyHandlerV2,
} from "aws-lambda";
import { favoriteCard } from "./cards.js";
import { getConfig } from "./config.js";
import {
  publicCrProfile,
  requestCrProfileRefresh,
  usesPlayerCollection,
} from "./cr-refresh.js";
import {
  completedGameWebhookPayload,
  loginWebhookPayload,
  publishDiscordEvent,
} from "./discord.js";
import { badRequest, HttpError } from "./errors.js";
import { isGameMode } from "./games.js";
import { bearerToken, json } from "./http.js";
import { sendMagicLink } from "./jmap.js";
import { generateNameOptions, isSafeFavoriteCardName } from "./names.js";
import { levelForGames } from "./progression.js";
import { Repository } from "./repository.js";
import { createChallenge, scoreRun } from "./scoring.js";
import { seasonForDate, upcomingSeasons } from "./seasons.js";
import { signToken, verifyToken } from "./signing.js";
import type {
  CrProfileSnapshot,
  NameClaims,
  RunTranscript,
  SessionClaims,
} from "./types.js";
import {
  emailSubject,
  normalizeEmail,
  normalizeGameReturnPath,
  normalizePlayerTag,
  requireObject,
} from "./validation.js";

const MAGIC_LINK_SECONDS = 15 * 60;
const SESSION_SECONDS = 10 * 24 * 60 * 60;
const RUN_SECONDS = 30 * 60;
const NAME_OPTIONS_SECONDS = 15 * 60;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function bodyOf(event: APIGatewayProxyEventV2): Record<string, unknown> {
  if (!event.body) return {};
  try {
    return requireObject(JSON.parse(event.body) as unknown);
  } catch (error) {
    throw badRequest(error);
  }
}

function issueSession(
  sub: string,
  secret: string,
  nowSeconds: number,
): { token: string; expiresAt: string } {
  const claims: SessionClaims = {
    type: "session",
    sub,
    iat: nowSeconds,
    exp: nowSeconds + SESSION_SECONDS,
  };
  return {
    token: signToken(claims, secret),
    expiresAt: new Date(claims.exp * 1_000).toISOString(),
  };
}

function sessionFor(
  event: APIGatewayProxyEventV2,
  secret: string,
  required: true,
): SessionClaims;
function sessionFor(
  event: APIGatewayProxyEventV2,
  secret: string,
  required?: false,
): SessionClaims | undefined;
function sessionFor(
  event: APIGatewayProxyEventV2,
  secret: string,
  required = false,
): SessionClaims | undefined {
  const token = bearerToken(event.headers.authorization);
  if (!token) {
    if (required)
      throw new HttpError(
        401,
        "Sign in to continue.",
        "authentication_required",
      );
    return undefined;
  }
  try {
    return verifyToken(token, "session", secret);
  } catch {
    throw new HttpError(
      401,
      "Your session has expired. Sign in again.",
      "invalid_session",
    );
  }
}

function profileResponse(
  profile: {
    sub: string;
    playerId: string;
    email: string;
    publicName?: string;
    favoriteCardId?: number;
    playerTag?: string;
    totalGames: number;
    createdAt: string;
    updatedAt: string;
  },
  crProfile?: CrProfileSnapshot,
) {
  return {
    id: profile.playerId,
    email: profile.email,
    publicName: profile.publicName,
    favoriteCardId: profile.favoriteCardId,
    playerTag: profile.playerTag,
    ...(profile.playerTag
      ? { clashRoyale: publicCrProfile(profile.playerTag, crProfile) }
      : {}),
    totalGames: profile.totalGames,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    ...levelForGames(profile.totalGames),
  };
}

async function refreshedCrProfile(
  repository: Repository,
  queueUrl: string,
  tag: string | undefined,
): Promise<CrProfileSnapshot | undefined> {
  if (!tag) return undefined;
  try {
    return await requestCrProfileRefresh(repository, queueUrl, tag);
  } catch (error) {
    console.error("CR profile refresh could not be queued", {
      playerTag: tag,
      error: error instanceof Error ? error.name : "unknown",
    });
    return repository.getCrProfile(tag);
  }
}

async function route(event: APIGatewayProxyEventV2) {
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  if (method === "OPTIONS") return { statusCode: 204 };
  if (method === "GET" && path === "/health")
    return json(200, { ok: true, service: "elixir-drop-api" });

  const config = getConfig();
  const repository = new Repository(config.tableName);

  if (method === "POST" && path === "/auth/request") {
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
    ]);

    const token = randomBytes(32).toString("base64url");
    const tokenHash = sha256(token);
    const expiresAt = Math.floor(Date.now() / 1_000) + MAGIC_LINK_SECONDS;
    await repository.saveMagicLink(tokenHash, email, expiresAt);
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
    });
  }

  if (method === "POST" && path === "/auth/redeem") {
    const body = bodyOf(event);
    if (typeof body.token !== "string" || body.token.length < 32)
      throw new HttpError(400, "A login token is required.");
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const email = await repository.consumeMagicLink(
      sha256(body.token),
      nowSeconds,
    );
    const sub = emailSubject(email);
    const login = await repository.ensureProfile(sub, email);
    const session = issueSession(sub, config.sessionSecret, nowSeconds);
    console.info("Player login completed", {
      requestId: event.requestContext.requestId,
      playerId: login.profile.playerId,
      newPlayer: login.created,
    });
    await Promise.all([
      publishDiscordEvent(
        config.discordWebhookUrl,
        loginWebhookPayload({
          profile: login.profile,
          newPlayer: login.created,
        }),
      ),
      refreshedCrProfile(
        repository,
        config.crRequestQueueUrl,
        login.profile.playerTag,
      ),
    ]);
    return json(200, {
      session,
    });
  }

  if (method === "POST" && path === "/auth/refresh") {
    const session = sessionFor(event, config.sessionSecret, true);
    return json(200, {
      session: issueSession(
        session.sub,
        config.sessionSecret,
        Math.floor(Date.now() / 1_000),
      ),
    });
  }

  if (method === "GET" && path === "/me") {
    const session = sessionFor(event, config.sessionSecret, true);
    const profile = await repository.getProfile(session.sub);
    if (!profile)
      throw new HttpError(
        404,
        "Player profile was not found.",
        "profile_not_found",
      );
    const [recentRuns, crProfile] = await Promise.all([
      repository.listRecentRuns(session.sub),
      profile.playerTag
        ? repository.getCrProfile(profile.playerTag)
        : undefined,
    ]);
    return json(200, {
      player: profileResponse(profile, crProfile),
      recentRuns,
    });
  }

  if (method === "POST" && path === "/me/name-options") {
    const session = sessionFor(event, config.sessionSecret, true);
    const body = bodyOf(event);
    const card = favoriteCard(body.favoriteCardId);
    if (!card)
      throw new HttpError(
        400,
        "Choose a valid favorite card.",
        "invalid_favorite_card",
      );
    await repository.useRateLimit("names", session.sub, 10, 60 * 60);
    const names = await generateNameOptions(config.nameModelId, card.name);
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const claims: NameClaims = {
      type: "names",
      sub: session.sub,
      favoriteCardId: card.id,
      names,
      iat: nowSeconds,
      exp: nowSeconds + NAME_OPTIONS_SECONDS,
    };
    return json(200, {
      favoriteCardId: card.id,
      names,
      nameToken: signToken(claims, config.sessionSecret),
    });
  }

  if (method === "PATCH" && path === "/me") {
    const session = sessionFor(event, config.sessionSecret, true);
    const body = bodyOf(event);
    const updates: {
      publicName?: string;
      favoriteCardId?: number;
      playerTag?: string;
      clearPlayerTag?: boolean;
    } = {};

    if (Object.hasOwn(body, "playerTag")) {
      const tag = normalizePlayerTag(body.playerTag);
      if (tag) updates.playerTag = tag;
      else updates.clearPlayerTag = true;
    }
    const changesIdentity =
      Object.hasOwn(body, "publicName") ||
      Object.hasOwn(body, "favoriteCardId");
    if (changesIdentity) {
      const card = favoriteCard(body.favoriteCardId);
      if (
        !card ||
        !isSafeFavoriteCardName(body.publicName, card.name) ||
        typeof body.nameToken !== "string"
      ) {
        throw new HttpError(
          400,
          "Choose a favorite card and one of its generated player names.",
          "invalid_player_identity",
        );
      }
      let nameClaims: NameClaims;
      try {
        nameClaims = verifyToken(body.nameToken, "names", config.sessionSecret);
      } catch {
        throw new HttpError(
          400,
          "Those name choices have expired. Choose your card again.",
          "expired_name_options",
        );
      }
      if (
        nameClaims.sub !== session.sub ||
        nameClaims.favoriteCardId !== card.id ||
        !nameClaims.names.includes(body.publicName)
      ) {
        throw new HttpError(
          400,
          "Choose a favorite card and one of its generated player names.",
          "invalid_player_identity",
        );
      }
      updates.publicName = body.publicName;
      updates.favoriteCardId = card.id;
    }
    if (!Object.keys(updates).length)
      throw new HttpError(400, "No profile changes were provided.");
    const profile = await repository.updateProfile(session.sub, updates);
    const crProfile = profile.playerTag
      ? updates.playerTag
        ? await refreshedCrProfile(
            repository,
            config.crRequestQueueUrl,
            profile.playerTag,
          )
        : await repository.getCrProfile(profile.playerTag)
      : undefined;
    return json(200, { player: profileResponse(profile, crProfile) });
  }

  if (method === "POST" && path === "/runs/start") {
    const body = bodyOf(event);
    if (!isGameMode(body.mode))
      throw new HttpError(400, "Choose a valid game mode.");
    const session = sessionFor(event, config.sessionSecret, true);
    await repository.useRateLimit(
      "run-start",
      sha256(event.requestContext.http.sourceIp || "unknown"),
      300,
      60 * 60,
    );
    const owner = session.sub;
    const profile = await repository.getProfile(session.sub);
    if (!profile?.favoriteCardId || !profile.publicName)
      throw new HttpError(
        409,
        "Choose a favorite card and player name before starting a game.",
        "profile_setup_required",
      );
    let playerCardIds: number[] | undefined;
    if (usesPlayerCollection(body.mode)) {
      if (profile.playerTag) {
        const crProfile = await repository.getCrProfile(profile.playerTag);
        if (crProfile?.status === "ready")
          playerCardIds = crProfile.cards?.map((card) => card.id);
      }
    }
    const challenge = createChallenge(body.mode, randomInt, { playerCardIds });
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const run = await repository.createRun(
      owner,
      body.mode,
      challenge,
      nowSeconds + RUN_SECONDS,
    );
    const runToken = signToken(
      {
        type: "run",
        runId: run.runId,
        owner,
        mode: body.mode,
        iat: nowSeconds,
        exp: nowSeconds + RUN_SECONDS,
      },
      config.sessionSecret,
    );
    return json(201, {
      runId: run.runId,
      runToken,
      mode: run.mode,
      challenge: run.challenge,
      expiresAt: new Date((nowSeconds + RUN_SECONDS) * 1_000).toISOString(),
    });
  }

  if (method === "POST" && path === "/runs/complete") {
    const body = bodyOf(event);
    const session = sessionFor(event, config.sessionSecret, true);
    if (typeof body.runToken !== "string")
      throw new HttpError(400, "A signed run token is required.");
    let claims;
    try {
      claims = verifyToken(body.runToken, "run", config.sessionSecret);
    } catch {
      throw new HttpError(
        401,
        "This run token is invalid or expired.",
        "invalid_run_token",
      );
    }
    const run = await repository.getRun(claims.runId);
    if (!run || run.owner !== claims.owner || run.mode !== claims.mode) {
      throw new HttpError(
        409,
        "This run was already recorded or is no longer valid.",
        "run_conflict",
      );
    }
    if (session.sub !== run.owner)
      throw new HttpError(
        403,
        "This run belongs to another player.",
        "run_owner_mismatch",
      );
    if (run.state === "completed") {
      if (!run.completedAt || typeof run.score !== "number" || !run.seasonId)
        throw new HttpError(
          409,
          "This run was already recorded but its result is unavailable.",
          "run_conflict",
        );
      const profile = await repository.getProfile(run.owner);
      if (!profile)
        throw new HttpError(
          404,
          "Player profile was not found.",
          "profile_not_found",
        );
      const season = seasonForDate(new Date(run.completedAt));
      const progress = levelForGames(profile.totalGames);
      return json(200, {
        accepted: true,
        runId: run.runId,
        mode: run.mode,
        score: run.score,
        season: { ...season, id: run.seasonId },
        completedAt: run.completedAt,
        totalGames: profile.totalGames,
        ...progress,
      });
    }
    const nowSeconds = Math.floor(Date.now() / 1_000);
    if (run.expiresAt <= nowSeconds)
      throw new HttpError(
        410,
        "This run expired before it was completed.",
        "run_expired",
      );
    let score: number;
    try {
      const transcript = requireObject(body.transcript ?? {}) as RunTranscript;
      const wallElapsedMs = Date.now() - new Date(run.startedAt).getTime();
      score = scoreRun(run.challenge, transcript, wallElapsedMs);
    } catch (error) {
      throw badRequest(error);
    }

    const season = seasonForDate();
    const result = await repository.completeRun(run, score, season.id);
    console.info("Game completed", {
      runId: run.runId,
      mode: run.mode,
      score,
      seasonId: season.id,
    });
    await publishDiscordEvent(
      config.discordWebhookUrl,
      completedGameWebhookPayload({
        runId: run.runId,
        mode: run.mode,
        score,
        seasonId: season.id,
        completedAt: result.completedAt,
        profile: result.profile,
      }),
    );
    return json(201, {
      accepted: true,
      runId: run.runId,
      mode: run.mode,
      score,
      season,
      completedAt: result.completedAt,
      totalGames: result.totalGames,
      ...levelForGames(result.totalGames),
    });
  }

  if (method === "GET" && path === "/leaderboards") {
    const mode = event.queryStringParameters?.mode;
    if (!isGameMode(mode))
      throw new HttpError(400, "Choose a valid game mode.");
    const currentSeason = seasonForDate();
    const seasonId = event.queryStringParameters?.season || currentSeason.id;
    if (!/^\d{4}-\d{2}$/.test(seasonId))
      throw new HttpError(400, "Season must use YYYY-MM format.");
    const entries = await repository.leaderboard(mode, seasonId);
    return json(200, { mode, seasonId, currentSeason, entries });
  }

  if (method === "GET" && path === "/seasons") {
    const current = seasonForDate();
    return json(200, { current, upcoming: upcomingSeasons(new Date(), 3) });
  }

  if (method === "GET" && path === "/stats") {
    const stats = await repository.globalStats();
    return json(200, { ...stats, currentSeason: seasonForDate() });
  }

  throw new HttpError(404, "Route not found.", "not_found");
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    return await route(event);
  } catch (error) {
    const safeError =
      error instanceof HttpError
        ? error
        : new HttpError(
            500,
            "The API could not complete the request.",
            "internal_error",
          );
    console.error("API request failed", {
      method: event.requestContext.http.method,
      path: event.rawPath,
      statusCode: safeError.statusCode,
      code: safeError.code,
      error: error instanceof Error ? error.name : "unknown",
    });
    return json(safeError.statusCode, {
      error: { code: safeError.code, message: safeError.message },
    });
  }
};

export { crResultHandler } from "./cr-results.js";
