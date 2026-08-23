import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import {
  BADGE_BY_SLUG,
  BADGE_LIST,
  arenaForXp,
  badgeTier,
  formatBadgeRungValue,
  playerReference,
} from "@elixir-drop/contracts";
import { HttpError } from "../errors.js";
import { json } from "../http.js";
import {
  publishedPageResponse,
  renderPublishedSharePage,
} from "../published-page.js";
import type { PublishedProfileShareItem } from "../repository.js";
import { getProfileShareImage, putProfileShareImage } from "../share-assets.js";
import { uploadedSharePng } from "../share-preview.js";
import {
  bodyOf,
  clientIpHash,
  sessionFor,
  type RouteContext,
} from "./context.js";
import { badgeSummary } from "./me.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLAYER_TAG_PATTERN = /^P[0-9A-HJKMNP-TV-Z]{10}$/;

export function isPublishedProfileReference(
  playerId: unknown,
): playerId is string {
  return typeof playerId === "string" && UUID_PATTERN.test(playerId);
}

function publicPlayerTag(share: PublishedProfileShareItem): string {
  return share.playerTag ?? playerReference(share.playerId).slice(1);
}

function shareUrl(appUrl: string, share: PublishedProfileShareItem): string {
  return `${appUrl}/share/${publicPlayerTag(share)}`;
}

function imageUrl(appUrl: string, share: PublishedProfileShareItem): string {
  return `${appUrl}/share-assets/${publicPlayerTag(share)}`;
}

function previewOf(share: PublishedProfileShareItem) {
  return {
    playerName: share.player.publicName,
    ...(share.player.favoriteCardId
      ? { favoriteCardId: share.player.favoriteCardId }
      : {}),
    xp: share.player.xp,
    arena: share.arena,
    badgeCount: share.badgeCount,
    badges: share.badges,
  };
}

function publishedResponse(share: PublishedProfileShareItem, appUrl: string) {
  return {
    playerId: share.playerId,
    url: shareUrl(appUrl, share),
    preview: previewOf(share),
  };
}

export function profileShareImageAlt(share: PublishedProfileShareItem): string {
  const badgeNames = share.badges.map((badge) => badge.name).join(", ");
  const highlights = badgeNames ? ` Highlights include ${badgeNames}.` : "";
  return `Elixir Drop profile for ${share.player.publicName}: Arena ${share.arena}, ${share.player.xp.toLocaleString("en-US")} Player XP, and ${share.badgeCount} earned ${share.badgeCount === 1 ? "badge" : "badges"}.${highlights}`;
}

async function publishedProfile(
  context: RouteContext,
  playerTag: string,
): Promise<PublishedProfileShareItem> {
  const normalized = playerTag.toUpperCase();
  if (!PLAYER_TAG_PATTERN.test(normalized))
    throw new HttpError(
      404,
      "That shared player profile could not be found.",
      "not_found",
    );
  const share =
    await context.repository.getPublishedProfileShareByTag(normalized);
  if (!share)
    throw new HttpError(
      404,
      "That shared player profile could not be found.",
      "not_found",
    );
  return share;
}

export function renderPublishedProfilePage(
  share: PublishedProfileShareItem,
  appUrl: string,
): string {
  const title = `${share.player.publicName}'s player profile | Elixir Drop`;
  const description = `${share.player.publicName} is Arena ${share.arena} with ${share.player.xp.toLocaleString("en-US")} Player XP and ${share.badgeCount} earned ${share.badgeCount === 1 ? "badge" : "badges"}.`;
  const profile = `${appUrl}/#/players/${encodeURIComponent(share.playerId)}`;
  return renderPublishedSharePage({
    title,
    description,
    canonical: shareUrl(appUrl, share),
    image: imageUrl(appUrl, share),
    imageAlt: profileShareImageAlt(share),
    challenge: `${appUrl}/#/`,
    cta: "PLAY ELIXIR DROP",
    pitch:
      "Learn Clash Royale elixir costs, climb your arena, and build a badge wall of your own.",
    profile,
    playerName: share.player.publicName,
    scriptSrc: "/assets/share/profile-open.js",
    bodyData: { "share-player-id": share.playerId },
  });
}

function profileBadgeHighlights(
  states: Array<{ slug: string; rungIndex: number }>,
): PublishedProfileShareItem["badges"] {
  const tierRank = {
    prismatic: 0,
    gold: 1,
    silver: 2,
    copper: 3,
    unlit: 4,
  } as const;
  return states
    .flatMap((state) => {
      const definition = BADGE_BY_SLUG.get(state.slug);
      const milestone = definition?.rungs[state.rungIndex];
      if (!definition || state.rungIndex < 0 || milestone === undefined)
        return [];
      return [
        {
          slug: definition.slug,
          name: definition.name,
          tier: badgeTier(state.rungIndex, definition.rungs.length),
          chip: formatBadgeRungValue(milestone, definition.unit),
          order: BADGE_LIST.indexOf(definition),
        },
      ];
    })
    .sort(
      (left, right) =>
        tierRank[left.tier] - tierRank[right.tier] || left.order - right.order,
    )
    .slice(0, 3)
    .map(({ order: _order, ...badge }) => badge);
}

export async function createPublishedProfileShare(context: RouteContext) {
  const { event, config, repository } = context;
  const session = sessionFor(event, config.sessionSecret, true);
  await repository.useRateLimit(
    "share-mint",
    clientIpHash(event, config.webOriginToken),
    60,
    60 * 60,
  );
  const profile = await repository.getProfile(session.sub);
  if (!profile || !profile.publicName || !config.shareAssetBucket)
    throw new HttpError(
      503,
      "Profile sharing is unavailable right now.",
      "share_unavailable",
    );
  const summary = await badgeSummary(
    context,
    session.sub,
    profile.playerId,
    profile,
  );
  const current = (await repository.getProfile(session.sub)) ?? profile;
  const xp = current.xp ?? 0;
  const item: PublishedProfileShareItem = {
    pk: `SHARE#PROFILE#${current.playerId}`,
    sk: "SHARE",
    kind: "published-profile",
    owner: session.sub,
    playerId: current.playerId,
    playerTag: playerReference(current.playerId).slice(1),
    publishedAt: new Date().toISOString(),
    player: {
      id: current.playerId,
      publicName: current.publicName ?? profile.publicName,
      ...(current.favoriteCardId
        ? { favoriteCardId: current.favoriteCardId }
        : {}),
      xp,
      totalGames: current.totalGames,
    },
    arena: arenaForXp(xp),
    badgeCount: summary.badges.filter((badge) => badge.rungIndex >= 0).length,
    badges: profileBadgeHighlights(summary.badges),
  };
  await repository.putPublishedProfileShare(item);
  return json(200, publishedResponse(item, config.appUrl));
}

export async function uploadPublishedProfileImage(context: RouteContext) {
  const { event, config, repository } = context;
  const session = sessionFor(event, config.sessionSecret, true);
  const profile = await repository.getProfile(session.sub);
  if (!profile || !config.shareAssetBucket)
    throw new HttpError(
      503,
      "Profile sharing is unavailable right now.",
      "share_unavailable",
    );
  const share = await repository.getPublishedProfileShare(profile.playerId);
  if (!share || share.owner !== session.sub)
    throw new HttpError(
      404,
      "That shared player profile could not be found.",
      "not_found",
    );
  await repository.useRateLimit(
    "share-image",
    clientIpHash(event, config.webOriginToken),
    60,
    60 * 60,
  );
  const body = bodyOf(event);
  await putProfileShareImage(
    config.shareAssetBucket,
    share.playerId,
    uploadedSharePng(body.image),
  );
  return json(200, { ok: true });
}

export async function getPublishedProfilePage(
  context: RouteContext,
  playerTag: string,
  head = false,
) {
  const share = await publishedProfile(context, playerTag);
  return publishedPageResponse(
    renderPublishedProfilePage(share, context.config.appUrl),
    head,
  );
}

export async function getPublishedProfileImage(
  context: RouteContext,
  playerTag: string,
  head = false,
): Promise<APIGatewayProxyStructuredResultV2> {
  const share = await publishedProfile(context, playerTag);
  const bucket = context.config.shareAssetBucket;
  if (!bucket)
    throw new HttpError(
      404,
      "That shared player profile could not be found.",
      "not_found",
    );
  const image = await getProfileShareImage(bucket, share.playerId);
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
