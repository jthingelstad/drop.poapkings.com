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
const MAX_PREVIEW_BYTES = 2_000_000;
const PNG_SIGNATURE = "89504e470d0a1a0a";
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

function escaped(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escaped(title)}</title>
  <meta name="description" content="${escaped(description)}">
  <meta name="robots" content="noindex,nofollow">
  <link rel="canonical" href="${escaped(canonical)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Elixir Drop">
  <meta property="og:title" content="${escaped(title)}">
  <meta property="og:description" content="${escaped(description)}">
  <meta property="og:url" content="${escaped(canonical)}">
  <meta property="og:image" content="${escaped(image)}">
  <meta property="og:image:alt" content="${escaped(imageAlt)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:type" content="image/png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escaped(title)}">
  <meta name="twitter:description" content="${escaped(description)}">
  <meta name="twitter:image" content="${escaped(image)}">
  <meta name="twitter:image:alt" content="${escaped(imageAlt)}">
  <style>
    @font-face{font-family:"Clash Royale";src:url("/assets/fonts/Clash_Regular.otf") format("opentype");font-weight:400;font-style:normal;font-display:swap}
    :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#120a30;color:#fff}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 80% 8%,#4a257c 0,transparent 32%),linear-gradient(180deg,#180d38,#0e0922);display:grid;place-items:center;padding:24px}
    main{width:min(100%,760px)}header{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;font-family:"Clash Royale",system-ui,sans-serif;letter-spacing:.03em}.free{font-family:Inter,ui-sans-serif,system-ui,sans-serif;font-size:.78rem;color:#c6afe9;letter-spacing:0}
    .card{display:block;width:100%;border-radius:24px;border:1px solid #6a459d;box-shadow:0 24px 70px #090513;overflow:hidden;background:#1b1237}.card img{display:block;width:100%;height:auto}
    .pitch{margin:24px auto 16px;max-width:620px;text-align:center;color:#d6c7ec;line-height:1.55}.cta{display:block;width:100%;padding:18px 24px;border-radius:16px;background:#ffd55c;color:#201238;text-decoration:none;text-align:center;font-family:"Clash Royale",system-ui,sans-serif;font-size:1.15rem;box-shadow:0 7px 0 #a56d13}.player{display:flex;align-items:center;justify-content:space-between;margin-top:20px;padding:16px 18px;border:1px solid #4d356d;border-radius:16px;color:#fff;text-decoration:none;background:#1b1237}.player strong{font-family:"Clash Royale",system-ui,sans-serif}.player span:last-child{color:#d1b5ff}.fan{text-align:center;color:#907ba9;font-size:.75rem;margin:24px 0 0}
    @media(max-width:520px){body{padding:16px}header{font-size:.88rem}.free{font-size:.7rem}.card{border-radius:16px}.pitch{font-size:.94rem}}
  </style>
</head>
<body data-share-player-id="${escaped(share.playerId)}" data-share-run-id="${escaped(share.runId)}">
  <main>
    <header><span>ELIXIR DROP</span><span class="free">Free · no account needed</span></header>
    <a class="card" href="${escaped(challenge)}"><img src="${escaped(image)}" width="1200" height="630" alt="${escaped(imageAlt)}"></a>
    <p class="pitch">${escaped(game.pitch)}</p>
    <a class="cta" href="${escaped(challenge)}">BEAT ${escaped(score)}</a>
    <a class="player" href="${escaped(profile)}"><strong>${escaped(share.player.publicName)}</strong><span>View profile →</span></a>
    <p class="fan">Fan content, not affiliated with Supercell.</p>
  </main>
  <script src="/assets/share/run-open.js" defer></script>
</body>
</html>`;
}

function html(body: string, head = false): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "content-security-policy":
        "default-src 'none'; img-src 'self'; font-src 'self'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "x-robots-tag": "noindex, nofollow",
    },
    body: head ? "" : body,
  };
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

function uploadedPng(body: Record<string, unknown>): Buffer {
  const encoded = body.image;
  if (
    typeof encoded !== "string" ||
    encoded.length === 0 ||
    encoded.length > Math.ceil((MAX_PREVIEW_BYTES * 4) / 3) + 4 ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  )
    throw new HttpError(
      400,
      "The share preview is invalid.",
      "invalid_share_preview",
    );
  const image = Buffer.from(encoded, "base64");
  if (
    image.length < 24 ||
    image.length > MAX_PREVIEW_BYTES ||
    image.subarray(0, 8).toString("hex") !== PNG_SIGNATURE ||
    image.subarray(12, 16).toString("ascii") !== "IHDR" ||
    image.readUInt32BE(16) !== 1_200 ||
    image.readUInt32BE(20) !== 630
  )
    throw new HttpError(
      400,
      "The share preview is invalid.",
      "invalid_share_preview",
    );
  return image;
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
    uploadedPng(body),
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
  return html(renderPublishedRunPage(share, context.config.appUrl), head);
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
