import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { HttpError } from "../errors.js";
import { isGameMode } from "../games.js";
import { refereeReviewStatus } from "../referee-status.js";
import type { PublishedRunShareItem } from "../repository.js";
import {
  deleteRunShareImage,
  getRunShareImage,
  putRunShareImage,
} from "../share-assets.js";
import { renderRunShareImage, shareScore } from "../share-image.js";
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

function shareUrl(appUrl: string, playerId: string, runId: string): string {
  return `${appUrl}/share/${playerId}/${runId}`;
}

function imageUrl(appUrl: string, playerId: string, runId: string): string {
  return `${appUrl}/share-assets/${playerId}/${runId}`;
}

async function publishedShare(
  context: RouteContext,
  playerId: string,
  runId: string,
): Promise<PublishedRunShareItem> {
  if (!isPublishedRunReference(playerId, runId))
    throw new HttpError(
      404,
      "That shared run could not be found.",
      "not_found",
    );
  const share = await context.repository.getPublishedRunShare(playerId, runId);
  if (!share)
    throw new HttpError(
      404,
      "That shared run could not be found.",
      "not_found",
    );
  const decision = (await context.repository.refereeDecisions([runId])).get(
    runId,
  );
  if (refereeReviewStatus(decision) === "excluded") {
    if (context.config.shareAssetBucket)
      await deleteRunShareImage(
        context.config.shareAssetBucket,
        playerId,
        runId,
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
  const canonical = shareUrl(appUrl, share.playerId, share.runId);
  const image = imageUrl(appUrl, share.playerId, share.runId);
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
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:type" content="image/png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escaped(title)}">
  <meta name="twitter:description" content="${escaped(description)}">
  <meta name="twitter:image" content="${escaped(image)}">
  <style>
    :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#120a30;color:#fff}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 80% 8%,#4a257c 0,transparent 32%),linear-gradient(180deg,#180d38,#0e0922);display:grid;place-items:center;padding:24px}
    main{width:min(100%,760px)}header{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;font-weight:900;letter-spacing:.08em}.free{font-size:.78rem;color:#c6afe9;letter-spacing:0}
    .card{display:block;width:100%;border-radius:24px;border:1px solid #6a459d;box-shadow:0 24px 70px #090513;overflow:hidden;background:#1b1237}.card img{display:block;width:100%;height:auto}
    .pitch{margin:24px auto 16px;max-width:620px;text-align:center;color:#d6c7ec;line-height:1.55}.cta{display:block;width:100%;padding:18px 24px;border-radius:16px;background:#ffd55c;color:#201238;text-decoration:none;text-align:center;font-size:1.15rem;font-weight:950;box-shadow:0 7px 0 #a56d13}.player{display:flex;align-items:center;justify-content:space-between;margin-top:20px;padding:16px 18px;border:1px solid #4d356d;border-radius:16px;color:#fff;text-decoration:none;background:#1b1237}.player span:last-child{color:#d1b5ff}.fan{text-align:center;color:#907ba9;font-size:.75rem;margin:24px 0 0}
    @media(max-width:520px){body{padding:16px}header{font-size:.88rem}.free{font-size:.7rem}.card{border-radius:16px}.pitch{font-size:.94rem}}
  </style>
</head>
<body>
  <main>
    <header><span>ELIXIR DROP</span><span class="free">Free · no account needed</span></header>
    <a class="card" href="${escaped(challenge)}"><img src="${escaped(image)}" width="1200" height="630" alt="${escaped(`${share.player.publicName}'s ${game.name} run: ${score}`)}"></a>
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
        "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
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
  if (existing)
    return json(200, {
      playerId: existing.playerId,
      runId: existing.runId,
      url: shareUrl(config.appUrl, existing.playerId, existing.runId),
    });

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
  await putRunShareImage(
    config.shareAssetBucket,
    item.playerId,
    item.runId,
    renderRunShareImage(item),
  );
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
  return json(created ? 201 : 200, {
    playerId: published.playerId,
    runId: published.runId,
    url: shareUrl(config.appUrl, published.playerId, published.runId),
  });
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
  let image = await getRunShareImage(bucket, playerId, runId);
  if (!image) {
    image = renderRunShareImage(share);
    await putRunShareImage(bucket, playerId, runId, image);
  }
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
      `share-run:${playerId}:${runId}:${clientIp(event, config.webOriginToken)}:${event.headers["user-agent"] ?? "unknown"}`,
    );
    try {
      const credited = await repository.creditPublishedRunOpen(
        playerId,
        runId,
        visitorHash,
        OPEN_CREDIT_CAP,
      );
      if (credited) await repository.addHeraldOpens(share.owner, 1);
    } catch (error) {
      console.warn("Published run open could not be credited", {
        playerId,
        runId,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
  return { statusCode: 204, headers: { "cache-control": "no-store" } };
}
