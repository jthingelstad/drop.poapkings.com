import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import {
  BADGE_BY_SLUG,
  badgeTier,
  formatBadgeRungValue,
  playerReference,
} from "@elixir-drop/contracts";
import { rungIndexFor } from "../badges.js";
import { HttpError } from "../errors.js";
import { json } from "../http.js";
import {
  publishedPageResponse,
  renderPublishedSharePage,
} from "../published-page.js";
import type { PublishedBadgeShareItem } from "../repository.js";
import { getBadgeShareImage, putBadgeShareImage } from "../share-assets.js";
import { uploadedSharePng } from "../share-preview.js";
import {
  bodyOf,
  clientIpHash,
  sessionFor,
  type RouteContext,
} from "./context.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLAYER_TAG_PATTERN = /^P[0-9A-HJKMNP-TV-Z]{10}$/;
const BADGE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isPublishedBadgeReference(
  playerId: unknown,
  slug: unknown,
  rungIndex: unknown,
): playerId is string {
  return (
    typeof playerId === "string" &&
    UUID_PATTERN.test(playerId) &&
    typeof slug === "string" &&
    BADGE_BY_SLUG.has(slug) &&
    typeof rungIndex === "number" &&
    Number.isSafeInteger(rungIndex) &&
    rungIndex >= 0
  );
}

function publicBadgeReference(
  playerTag: string,
  slug: string,
  rung: string,
): { playerTag: string; slug: string; rungNumber: number } | undefined {
  const normalizedTag = playerTag.toUpperCase();
  const normalizedSlug = slug.toLowerCase();
  const rungNumber = Number(rung);
  if (
    !PLAYER_TAG_PATTERN.test(normalizedTag) ||
    !BADGE_SLUG_PATTERN.test(normalizedSlug) ||
    !BADGE_BY_SLUG.has(normalizedSlug) ||
    !Number.isSafeInteger(rungNumber) ||
    rungNumber < 1 ||
    rungNumber > 100
  )
    return undefined;
  return { playerTag: normalizedTag, slug: normalizedSlug, rungNumber };
}

function publicPlayerTag(share: PublishedBadgeShareItem): string {
  return share.playerTag ?? playerReference(share.playerId).slice(1);
}

function shareUrl(appUrl: string, share: PublishedBadgeShareItem): string {
  return `${appUrl}/share/${publicPlayerTag(share)}/badge/${share.slug}/${share.rungIndex + 1}`;
}

function imageUrl(appUrl: string, share: PublishedBadgeShareItem): string {
  return `${appUrl}/share-assets/${publicPlayerTag(share)}/badge/${share.slug}/${share.rungIndex + 1}`;
}

function previewOf(share: PublishedBadgeShareItem) {
  return {
    playerName: share.player.publicName,
    ...(share.player.favoriteCardId
      ? { favoriteCardId: share.player.favoriteCardId }
      : {}),
    slug: share.slug,
    name: share.badge.name,
    tier: share.badge.tier,
    chip: share.badge.chip,
    rungIndex: share.rungIndex,
    rungCount: share.badge.rungCount,
    ...(share.badge.hidden ? { hidden: true } : {}),
    ...(share.badge.requirement
      ? { requirement: share.badge.requirement }
      : {}),
  };
}

function publishedResponse(share: PublishedBadgeShareItem, appUrl: string) {
  return {
    playerId: share.playerId,
    slug: share.slug,
    rungIndex: share.rungIndex,
    url: shareUrl(appUrl, share),
    preview: previewOf(share),
  };
}

export function badgeShareImageAlt(share: PublishedBadgeShareItem): string {
  const rung = share.rungIndex + 1;
  const requirement = share.badge.requirement
    ? ` The milestone recognizes ${share.badge.requirement.toLowerCase()}.`
    : "";
  return `${share.player.publicName} earned the ${share.badge.name} badge at the ${share.badge.chip} milestone, rung ${rung} of ${share.badge.rungCount}.${requirement}`;
}

async function publishedBadge(
  context: RouteContext,
  playerTag: string,
  slug: string,
  rung: string,
): Promise<PublishedBadgeShareItem> {
  const reference = publicBadgeReference(playerTag, slug, rung);
  if (!reference)
    throw new HttpError(
      404,
      "That shared badge could not be found.",
      "not_found",
    );
  const share = await context.repository.getPublishedBadgeShareByTag(
    reference.playerTag,
    reference.slug,
    reference.rungNumber,
  );
  if (!share)
    throw new HttpError(
      404,
      "That shared badge could not be found.",
      "not_found",
    );
  return share;
}

export function renderPublishedBadgePage(
  share: PublishedBadgeShareItem,
  appUrl: string,
): string {
  const rung = share.rungIndex + 1;
  const title = `${share.player.publicName} earned ${share.badge.name} — ${share.badge.chip} | Elixir Drop`;
  const description = `${share.player.publicName} reached rung ${rung} of ${share.badge.rungCount} in ${share.badge.name}. Can you earn yours?`;
  return renderPublishedSharePage({
    title,
    description,
    canonical: shareUrl(appUrl, share),
    image: imageUrl(appUrl, share),
    imageAlt: badgeShareImageAlt(share),
    challenge: `${appUrl}/#/`,
    cta: "EARN YOURS",
    pitch:
      share.badge.requirement ??
      "Learn Clash Royale elixir costs, clear milestones, and build your badge wall.",
    profile: `${appUrl}/#/players/${encodeURIComponent(share.playerId)}`,
    playerName: share.player.publicName,
    scriptSrc: "/assets/share/badge-open.js",
    bodyData: {
      "share-player-id": share.playerId,
      "share-badge-slug": share.slug,
      "share-badge-rung": String(share.rungIndex),
    },
  });
}

export async function createPublishedBadgeShare(
  context: RouteContext,
  slug: string,
) {
  const { event, config, repository } = context;
  const session = sessionFor(event, config.sessionSecret, true);
  await repository.useRateLimit(
    "share-mint",
    clientIpHash(event, config.webOriginToken),
    60,
    60 * 60,
  );
  const definition = BADGE_BY_SLUG.get(slug);
  const body = bodyOf(event);
  const rungIndex = body.rungIndex;
  if (
    !definition ||
    typeof rungIndex !== "number" ||
    !Number.isSafeInteger(rungIndex) ||
    rungIndex < 0 ||
    rungIndex >= definition.rungs.length
  )
    throw new HttpError(
      404,
      "That earned badge could not be found.",
      "not_found",
    );
  const [profile, counters] = await Promise.all([
    repository.getProfile(session.sub),
    repository.getBadges(session.sub),
  ]);
  if (!profile || !profile.publicName || !config.shareAssetBucket)
    throw new HttpError(
      503,
      "Badge sharing is unavailable right now.",
      "share_unavailable",
    );
  const currentRung = rungIndexFor(
    definition,
    counters?.values[definition.slug],
  );
  const earnedAt = counters?.earned[definition.slug]?.[rungIndex];
  if (rungIndex > currentRung || !earnedAt)
    throw new HttpError(
      404,
      "That earned badge could not be found.",
      "not_found",
    );

  const existing = await repository.getPublishedBadgeShare(
    profile.playerId,
    definition.slug,
    rungIndex,
  );
  if (existing) return json(200, publishedResponse(existing, config.appUrl));

  const milestone = definition.rungs[rungIndex];
  if (milestone === undefined)
    throw new HttpError(
      404,
      "That earned badge could not be found.",
      "not_found",
    );
  const item: PublishedBadgeShareItem = {
    pk: `SHARE#BADGE#${profile.playerId}#${definition.slug}#${rungIndex}`,
    sk: "SHARE",
    kind: "published-badge",
    owner: session.sub,
    playerId: profile.playerId,
    playerTag: playerReference(profile.playerId).slice(1),
    slug: definition.slug,
    rungIndex,
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
    badge: {
      name: definition.name,
      tier: badgeTier(rungIndex, definition.rungs.length),
      chip: formatBadgeRungValue(milestone, definition.unit),
      milestone,
      rungCount: definition.rungs.length,
      earnedAt,
      ...(definition.hidden ? { hidden: true } : {}),
      ...(definition.requirement
        ? { requirement: definition.requirement }
        : {}),
    },
  };
  const created = await repository.putPublishedBadgeShare(item);
  const published = created
    ? item
    : await repository.getPublishedBadgeShare(
        item.playerId,
        item.slug,
        item.rungIndex,
      );
  if (!published)
    throw new HttpError(
      503,
      "Badge sharing is unavailable right now.",
      "share_unavailable",
    );
  return json(created ? 201 : 200, publishedResponse(published, config.appUrl));
}

export async function uploadPublishedBadgeImage(
  context: RouteContext,
  slug: string,
) {
  const { event, config, repository } = context;
  const session = sessionFor(event, config.sessionSecret, true);
  const body = bodyOf(event);
  const rungIndex = body.rungIndex;
  const profile = await repository.getProfile(session.sub);
  if (
    !profile ||
    !config.shareAssetBucket ||
    typeof rungIndex !== "number" ||
    !Number.isSafeInteger(rungIndex) ||
    rungIndex < 0
  )
    throw new HttpError(
      503,
      "Badge sharing is unavailable right now.",
      "share_unavailable",
    );
  const share = await repository.getPublishedBadgeShare(
    profile.playerId,
    slug,
    rungIndex,
  );
  if (!share || share.owner !== session.sub)
    throw new HttpError(
      404,
      "That shared badge could not be found.",
      "not_found",
    );
  await repository.useRateLimit(
    "share-image",
    clientIpHash(event, config.webOriginToken),
    60,
    60 * 60,
  );
  await putBadgeShareImage(
    config.shareAssetBucket,
    share.playerId,
    share.slug,
    share.rungIndex,
    uploadedSharePng(body.image),
  );
  return json(200, { ok: true });
}

export async function getPublishedBadgePage(
  context: RouteContext,
  playerTag: string,
  slug: string,
  rung: string,
  head = false,
) {
  const share = await publishedBadge(context, playerTag, slug, rung);
  return publishedPageResponse(
    renderPublishedBadgePage(share, context.config.appUrl),
    head,
  );
}

export async function getPublishedBadgeImage(
  context: RouteContext,
  playerTag: string,
  slug: string,
  rung: string,
  head = false,
): Promise<APIGatewayProxyStructuredResultV2> {
  const share = await publishedBadge(context, playerTag, slug, rung);
  const bucket = context.config.shareAssetBucket;
  if (!bucket)
    throw new HttpError(
      404,
      "That shared badge could not be found.",
      "not_found",
    );
  const image = await getBadgeShareImage(
    bucket,
    share.playerId,
    share.slug,
    share.rungIndex,
  );
  if (!image)
    return {
      statusCode: 302,
      headers: {
        location: `${context.config.appUrl}/assets/share/og-default.png`,
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
