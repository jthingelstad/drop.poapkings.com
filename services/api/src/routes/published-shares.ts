import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { playerReference, runReference } from "@elixir-drop/contracts";
import { HttpError } from "../errors.js";
import { isGameMode } from "../games.js";
import { refereeReviewStatus } from "../referee-status.js";
import type { PublishedRunShareItem } from "../repository.js";
import {
  deleteRunShareImage,
  getRunShareImage,
  putRunShareImage,
} from "../share-assets.js";
import { deriveRunShareVisual } from "../share-visual.js";
import { uploadedSharePng } from "../share-preview.js";
import {
  publishedPageResponse,
  renderPublishedSharePage,
} from "../published-page.js";
import { hmac } from "../referee-evidence.js";
import { json } from "../http.js";
import {
  bodyOf,
  clientIp,
  clientIpHash,
  sessionFor,
  type RouteContext,
} from "./context.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPEN_CREDIT_CAP = 25;
const OPEN_LIMIT_PER_HOUR = 600;
const PLAYER_TAG_PATTERN = /^P[0-9A-HJKMNP-TV-Z]{10}$/;
const RUN_TAG_PATTERN = /^D[0-9A-HJKMNP-TV-Z]{10}$/;

function shareScore(
  mode: PublishedRunShareItem["mode"],
  score: number,
): string {
  if (mode === "surge" || mode === "trade")
    return `${(score / 1_000).toFixed(3)}s`;
  if (mode === "rain") return `${score} CLEARED`;
  if (mode === "survival") return `${score} STREAK`;
  return `${score} CORRECT`;
}

export function isPublishedRunReference(
  playerId: unknown,
  runId: unknown,
): playerId is string {
  return (
    typeof playerId === "string" &&
    typeof runId === "string" &&
    UUID_PATTERN.test(playerId) &&
    UUID_PATTERN.test(runId)
  );
}

export function isPublishedRunTagReference(
  playerTag: unknown,
  runTag: unknown,
): playerTag is string {
  return (
    typeof playerTag === "string" &&
    typeof runTag === "string" &&
    PLAYER_TAG_PATTERN.test(playerTag) &&
    RUN_TAG_PATTERN.test(runTag)
  );
}

function modeDetails(mode: PublishedRunShareItem["mode"]): {
  name: string;
  path: string;
  pitch: string;
} {
  return {
    surge: {
      name: "Surge",
      path: "/surge",
      pitch:
        "Fifteen cards. One honest clock. Read every elixir cost before the arena reads you.",
    },
    trade: {
      name: "Trade",
      path: "/trade",
      pitch:
        "Read both sides of the exchange and call the elixir trade before the deal closes.",
    },
    survival: {
      name: "Survival",
      path: "/survival",
      pitch: "The clock keeps tightening. One wrong cost ends the run.",
    },
    rain: {
      name: "Rain",
      path: "/rain",
      pitch:
        "Catch falling cards with the right elixir cost before three reach the line.",
    },
    "higher-lower": {
      name: "Higher / Lower",
      path: "/higher-lower",
      pitch:
        "Two cards enter. Pick the one that costs more before the clock closes.",
    },
  }[mode];
}

function publicTags(share: PublishedRunShareItem): {
  playerTag: string;
  runTag: string;
} {
  return {
    playerTag: share.playerTag ?? playerReference(share.playerId).slice(1),
    runTag: share.runTag ?? runReference(share.runId).slice(1),
  };
}

function shareUrl(appUrl: string, share: PublishedRunShareItem): string {
  const { playerTag, runTag } = publicTags(share);
  return `${appUrl}/share/${playerTag}/${runTag}`;
}

function imageUrl(appUrl: string, share: PublishedRunShareItem): string {
  const { playerTag, runTag } = publicTags(share);
  return `${appUrl}/share-assets/${playerTag}/${runTag}`;
}

function previewOf(share: PublishedRunShareItem) {
  return {
    mode: share.mode,
    score: shareScore(share.mode, share.score),
    playerName: share.player.publicName,
    ...(share.player.favoriteCardId
      ? { favoriteCardId: share.player.favoriteCardId }
      : {}),
    ...(share.visual ? { visual: share.visual } : {}),
  };
}

function publishedResponse(share: PublishedRunShareItem, appUrl: string) {
  return {
    playerId: share.playerId,
    runId: share.runId,
    url: shareUrl(appUrl, share),
    preview: previewOf(share),
  };
}

export function runShareImageAlt(share: PublishedRunShareItem): string {
  const game = modeDetails(share.mode);
  const score = shareScore(share.mode, share.score);
  const visual = share.visual;
  if (!visual?.values.length)
    return `${share.player.publicName} scored ${score} in ${game.name} on Elixir Drop.`;
  const costly = visual.bad?.filter(Boolean).length ?? 0;
  const bars = `${visual.values.length} ${visual.values.length === 1 ? "result" : "results"}`;
  const mistakes = costly
    ? ` ${costly} ${costly === 1 ? "result is" : "results are"} marked as costly.`
    : "";
  return `${share.player.publicName} scored ${score} in ${game.name}. The run chart shows ${bars} in ${visual.unit.toLowerCase()}.${mistakes}`;
}

async function publishedShare(
  context: RouteContext,
  playerId: string,
  runId: string,
): Promise<PublishedRunShareItem> {
  const byId = isPublishedRunReference(playerId, runId);
  const normalizedPlayerTag = playerId.toUpperCase();
  const normalizedRunTag = runId.toUpperCase();
  const byTag = isPublishedRunTagReference(
    normalizedPlayerTag,
    normalizedRunTag,
  );
  if (!byId && !byTag)
    throw new HttpError(
      404,
      "That shared run could not be found.",
      "not_found",
    );
  const share = byId
    ? await context.repository.getPublishedRunShare(playerId, runId)
    : await context.repository.getPublishedRunShareByTags(
        normalizedPlayerTag,
        normalizedRunTag,
      );
  if (!share)
    throw new HttpError(
      404,
      "That shared run could not be found.",
      "not_found",
    );
  const decision = (
    await context.repository.refereeDecisions([share.runId])
  ).get(share.runId);
  if (refereeReviewStatus(decision) === "excluded") {
    if (context.config.shareAssetBucket)
      await deleteRunShareImage(
        context.config.shareAssetBucket,
        share.playerId,
        share.runId,
      ).catch(() => undefined);
    throw new HttpError(
      404,
      "That shared run could not be found.",
      "not_found",
    );
  }
  return share;
}

export function renderPublishedRunPage(
  share: PublishedRunShareItem,
  appUrl: string,
): string {
  const game = modeDetails(share.mode);
  const score = shareScore(share.mode, share.score);
  const title = `${share.player.publicName} scored ${score} in ${game.name} | Elixir Drop`;
  const description = `${share.player.publicName} put up ${score} in ${game.name}. Can you beat it?`;
  const canonical = shareUrl(appUrl, share);
  const image = imageUrl(appUrl, share);
  const imageAlt = runShareImageAlt(share);
  const challenge = `${appUrl}/#${game.path}`;
  const profile = `${appUrl}/#/players/${encodeURIComponent(share.playerId)}`;
  return renderPublishedSharePage({
    title,
    description,
    canonical,
    image,
    imageAlt,
    challenge,
    cta: `BEAT ${score}`,
    pitch: game.pitch,
    profile,
    playerName: share.player.publicName,
    scriptSrc: "/assets/share/run-open.js",
    bodyData: {
      "share-player-id": share.playerId,
      "share-run-id": share.runId,
    },
  });
}

export async function createPublishedRunShare(
  context: RouteContext,
  runId: string,
) {
  const { event, config, repository } = context;
  const session = sessionFor(event, config.sessionSecret, true);
  await repository.useRateLimit(
    "share-mint",
    clientIpHash(event, config.webOriginToken),
    60,
    60 * 60,
  );
  const profile = await repository.getProfile(session.sub);
  if (!profile)
    throw new HttpError(404, "Player profile not found.", "not_found");
  const body = bodyOf(event);
  const completedAt =
    typeof body.completedAt === "string" ? body.completedAt : undefined;
  const history = await repository.listRunHistory(session.sub);
  const run = history.find(
    (candidate) =>
      candidate.runId === runId &&
      (completedAt === undefined || candidate.completedAt === completedAt),
  );
  if (!run || !isGameMode(run.mode) || run.mode === "practice")
    throw new HttpError(
      404,
      "That recorded run could not be found.",
      "not_found",
    );
  const decisions = await repository.refereeDecisions([run.runId]);
  if (refereeReviewStatus(decisions.get(run.runId)) === "excluded")
    throw new HttpError(
      409,
      "That run is not publicly shareable.",
      "run_not_shareable",
    );

  const existing = await repository.getPublishedRunShare(
    profile.playerId,
    run.runId,
  );
  if (existing) {
    await repository.putPublishedRunShareAlias(existing);
    return json(200, publishedResponse(existing, config.appUrl));
  }

  let visual = run.shareVisual;
  if (!visual) {
    const previousBest = history
      .filter(
        (candidate) =>
          run.mode === "surge" &&
          candidate.mode === "surge" &&
          candidate.completedAt < run.completedAt,
      )
      .sort((left, right) => left.score - right.score)[0];
    const wanted = [run.runId];
    if (previousBest && !previousBest.shareVisual)
      wanted.push(previousBest.runId);
    const evidence = await repository.refereeEvidenceForRuns(
      session.sub,
      wanted,
    );
    const byRun = new Map(evidence.map((item) => [item.runId, item]));
    const previousVisual = previousBest
      ? (previousBest.shareVisual ??
        deriveRunShareVisual(byRun.get(previousBest.runId)))
      : undefined;
    visual = deriveRunShareVisual(byRun.get(run.runId), previousVisual);
    if (visual) {
      try {
        await repository.setRunShareVisual(
          session.sub,
          run.runId,
          run.completedAt,
          visual,
        );
      } catch (error) {
        console.warn("Run share visual could not be retained", {
          runId: run.runId,
          error: error instanceof Error ? error.name : "unknown",
        });
      }
    }
  }

  if (!profile.publicName || !config.shareAssetBucket)
    throw new HttpError(
      503,
      "Run sharing is unavailable right now.",
      "share_unavailable",
    );
  const item: PublishedRunShareItem = {
    pk: `SHARE#RUN#${profile.playerId}#${run.runId}`,
    sk: "SHARE",
    kind: "published-run",
    owner: session.sub,
    playerId: profile.playerId,
    runId: run.runId,
    playerTag: playerReference(profile.playerId).slice(1),
    runTag: runReference(run.runId).slice(1),
    mode: run.mode,
    score: run.score,
    seasonId: run.seasonId,
    completedAt: run.completedAt,
    publishedAt: new Date().toISOString(),
    player: {
      id: profile.playerId,
      publicName: profile.publicName,
      ...(profile.favoriteCardId
        ? { favoriteCardId: profile.favoriteCardId }
        : {}),
      xp: profile.xp ?? 0,
      totalGames: profile.totalGames,
    },
    ...(visual ? { visual } : {}),
  };
  const created = await repository.putPublishedRunShare(item);
  const published = created
    ? item
    : await repository.getPublishedRunShare(item.playerId, item.runId);
  if (!published)
    throw new HttpError(
      503,
      "Run sharing is unavailable right now.",
      "share_unavailable",
    );
  return json(created ? 201 : 200, publishedResponse(published, config.appUrl));
}

export async function uploadPublishedRunImage(
  context: RouteContext,
  runId: string,
) {
  const { event, config, repository } = context;
  const session = sessionFor(event, config.sessionSecret, true);
  const body = bodyOf(event);
  const completedAt =
    typeof body.completedAt === "string" ? body.completedAt : undefined;
  const profile = await repository.getProfile(session.sub);
  if (!profile || !config.shareAssetBucket)
    throw new HttpError(
      503,
      "Run sharing is unavailable right now.",
      "share_unavailable",
    );
  const share = await repository.getPublishedRunShare(profile.playerId, runId);
  if (
    !share ||
    share.owner !== session.sub ||
    (completedAt !== undefined && completedAt !== share.completedAt)
  )
    throw new HttpError(
      404,
      "That shared run could not be found.",
      "not_found",
    );
  const decisions = await repository.refereeDecisions([runId]);
  if (refereeReviewStatus(decisions.get(runId)) === "excluded")
    throw new HttpError(
      409,
      "That run is not publicly shareable.",
      "run_not_shareable",
    );
  await repository.useRateLimit(
    "share-image",
    clientIpHash(event, config.webOriginToken),
    60,
    60 * 60,
  );
  await putRunShareImage(
    config.shareAssetBucket,
    share.playerId,
    share.runId,
    uploadedSharePng(body.image),
  );
  return json(200, { ok: true });
}

export async function getPublishedRunPage(
  context: RouteContext,
  playerId: string,
  runId: string,
  head = false,
) {
  const share = await publishedShare(context, playerId, runId);
  return publishedPageResponse(
    renderPublishedRunPage(share, context.config.appUrl),
    head,
  );
}

export async function getPublishedRunImage(
  context: RouteContext,
  playerId: string,
  runId: string,
  head = false,
): Promise<APIGatewayProxyStructuredResultV2> {
  const share = await publishedShare(context, playerId, runId);
  const bucket = context.config.shareAssetBucket;
  if (!bucket)
    throw new HttpError(
      404,
      "That shared run could not be found.",
      "not_found",
    );
  const image = await getRunShareImage(bucket, share.playerId, share.runId);
  if (!image)
    return {
      statusCode: 302,
      headers: {
        location: `${context.config.appUrl}/assets/og-image.png`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "x-robots-tag": "noindex, nofollow",
      },
      body: "",
    };
  return {
    statusCode: 200,
    headers: {
      "content-type": "image/png",
      "cache-control": "private, no-store",
      "content-length": String(image.length),
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
    },
    body: head ? "" : image.toString("base64"),
    isBase64Encoded: !head,
  };
}

export async function openPublishedRunShare(
  context: RouteContext,
  playerId: string,
  runId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const { event, config, repository } = context;
  await repository.useRateLimit(
    "share-open",
    clientIpHash(event, config.webOriginToken),
    OPEN_LIMIT_PER_HOUR,
    60 * 60,
  );
  const share = await publishedShare(context, playerId, runId);
  const viewer = sessionFor(event, config.sessionSecret);
  if (viewer?.sub !== share.owner) {
    const visitorHash = hmac(
      config.telemetryPepper,
      `share-run:${share.playerId}:${share.runId}:${clientIp(event, config.webOriginToken)}:${event.headers["user-agent"] ?? "unknown"}`,
    );
    try {
      const credited = await repository.creditPublishedRunOpen(
        share.playerId,
        share.runId,
        visitorHash,
        OPEN_CREDIT_CAP,
      );
      if (credited) await repository.addHeraldOpens(share.owner, 1);
    } catch (error) {
      console.warn("Published run open could not be credited", {
        playerId: share.playerId,
        runId: share.runId,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
  return { statusCode: 204, headers: { "cache-control": "no-store" } };
}
