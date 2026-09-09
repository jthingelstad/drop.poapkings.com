import { timingSafeEqual } from "node:crypto";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { HttpError } from "../errors.js";
import { bearerToken, json } from "../http.js";
import {
  MAX_UPDATE_ENTRIES,
  renderUpdateMarkdownHtml,
  updateId,
  validateUpdateEntry,
  type UpdateEntry,
  type UpdateKind,
} from "../player-updates.js";
import { chargeRead } from "./public-reads.js";
import { bodyOf, type RouteContext } from "./context.js";

const SITE_URL = "https://drop.poapkings.com";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] ?? character,
  );
}

function limitFor(event: APIGatewayProxyEventV2, fallback: number): number {
  const raw = event.queryStringParameters?.limit;
  if (raw === undefined) return fallback;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_UPDATE_ENTRIES)
    throw new HttpError(
      400,
      `Update limit must be 1-${MAX_UPDATE_ENTRIES}.`,
      "invalid_limit",
    );
  return limit;
}

function updateKindLabel(kind: UpdateKind): string {
  return kind === "feature"
    ? "Feature"
    : kind === "season"
      ? "Season"
      : "Message";
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value));
}

function pageResponse(
  contentType: string,
  body: string,
  head: boolean,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=60",
      "x-content-type-options": "nosniff",
    },
    body: head ? "" : body,
  };
}

export function renderUpdatesPage(entries: UpdateEntry[]): string {
  const sections = entries.length
    ? entries
        .map(
          (
            entry,
          ) => `<section id="${escapeHtml(entry.id)}" class="static-section">
      <h2>${escapeHtml(entry.title)}</h2>
      <div class="static-section__body"><p class="static-update-stamp"><span>${updateKindLabel(entry.kind)}</span>${escapeHtml(dateLabel(entry.publishedAt))}</p><p>${renderUpdateMarkdownHtml(entry.body)}</p></div>
    </section>`,
        )
        .join("\n")
    : '<section class="static-section static-section--muted"><h2>The arena is quiet</h2><div class="static-section__body"><p>The first player update will appear here.</p></div></section>';
  const description =
    "New Elixir Drop player features, season winners, and messages, newest first.";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#070610">
  <title>Elixir Drop Updates | Elixir Drop</title>
  <meta name="description" content="${description}">
  <link rel="canonical" href="${SITE_URL}/updates/">
  <link rel="alternate" type="application/rss+xml" title="Elixir Drop Updates" href="${SITE_URL}/feed.xml">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Elixir Drop">
  <meta property="og:title" content="Elixir Drop Updates | Elixir Drop">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${SITE_URL}/updates/">
  <meta property="og:image" content="${SITE_URL}/assets/og-image.png">
  <link rel="icon" href="/assets/icon/drop-icon-192.png">
  <link rel="stylesheet" href="/static-pages.css">
</head>
<body>
  <header class="static-header">
    <div class="static-wrap static-header__row">
      <a class="static-brand" href="/" aria-label="Elixir Drop home"><img src="/assets/icon/drop-icon-192.png" width="42" height="42" alt=""><span>Elixir Drop</span></a>
      <a class="static-play" href="/">Play</a>
    </div>
    <nav class="static-wrap static-nav" aria-label="Elixir Drop information"><a href="/games/">Game Modes</a><a href="/xp/">Player XP</a><a href="/learn-elixir-costs/">Learn Elixir Costs</a><a href="/install/">Game Setup</a><a href="/fair-play/">Fair Play</a><a href="/about/">About</a><a href="/faq/">FAQ</a></nav>
  </header>
  <main class="static-wrap static-main">
    <header class="static-title"><p>From the arena</p><h1>Elixir Drop Updates</h1><span>Run by <a href="https://poapkings.com/elixir-drop/">POAP KINGS</a>.</span></header>
    <p class="static-intro">New features, season winners, and player messages—one clear update at a time. <a href="/feed.xml">Follow via RSS</a>.</p>
    <div class="static-sections">${sections}</div>
    <section class="static-cta"><h2>Ready to play?</h2><p>Learn the card costs, test your speed, and see where you rank.</p><a href="/">Play Elixir Drop</a></section>
  </main>
  <footer class="static-footer"><div class="static-wrap"><nav class="static-footer__nav" aria-label="More about Elixir Drop"><a href="/discord/">Discord</a><a href="/updates/" aria-current="page">Updates</a><a href="/privacy/">Privacy</a><a href="mailto:drop@poapkings.com">Contact</a><a href="https://poapkings.com/elixir-drop/">POAP KINGS</a></nav><p>This material is unofficial and is not endorsed by Supercell. For more information see Supercell’s Fan Content Policy: www.supercell.com/fan-content-policy.</p></div></footer>
</body>
</html>\n`;
}

function absoluteUpdateHtml(body: string): string {
  return renderUpdateMarkdownHtml(body)
    .replaceAll('href="/', `href="${SITE_URL}/`)
    .replaceAll('href="#', `href="${SITE_URL}/updates/#`);
}

export function renderUpdatesFeed(entries: UpdateEntry[]): string {
  const lastBuildDate = entries[0]
    ? `\n    <lastBuildDate>${new Date(entries[0].publishedAt).toUTCString()}</lastBuildDate>`
    : "";
  const items = entries
    .map((entry) => {
      const permalink = `${SITE_URL}/updates/#${encodeURIComponent(entry.id)}`;
      return `    <item>
      <title>${escapeHtml(entry.title)}</title>
      <link>${escapeHtml(permalink)}</link>
      <guid isPermaLink="true">${escapeHtml(permalink)}</guid>
      <pubDate>${new Date(entry.publishedAt).toUTCString()}</pubDate>
      <category>${updateKindLabel(entry.kind)}</category>
      <description>${escapeHtml(absoluteUpdateHtml(entry.body))}</description>
    </item>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Elixir Drop Updates</title>
    <link>${SITE_URL}/updates/</link>
    <description>New Elixir Drop player features, season results, and messages from POAP KINGS.</description>
    <language>en-us</language>${lastBuildDate}
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>\n`;
}

export async function getUpdates(context: RouteContext) {
  await chargeRead(context);
  return json(200, {
    entries: await context.repository.updates(limitFor(context.event, 100)),
  });
}

export async function getUpdatesPage(context: RouteContext, head: boolean) {
  await chargeRead(context);
  const entries = await context.repository.updates(MAX_UPDATE_ENTRIES);
  return pageResponse(
    "text/html; charset=utf-8",
    renderUpdatesPage(entries),
    head,
  );
}

export async function getUpdatesFeed(context: RouteContext, head: boolean) {
  await chargeRead(context);
  const entries = await context.repository.updates(MAX_UPDATE_ENTRIES);
  return pageResponse(
    "application/rss+xml; charset=utf-8",
    renderUpdatesFeed(entries),
    head,
  );
}

function publisherPrincipal(context: RouteContext): string {
  const expected = context.config.updatesPublishToken;
  const provided = bearerToken(context.event.headers.authorization);
  const expectedBytes = Buffer.from(expected ?? "");
  const providedBytes = Buffer.from(provided ?? "");
  if (
    !expected ||
    !provided ||
    expectedBytes.length !== providedBytes.length ||
    !timingSafeEqual(expectedBytes, providedBytes)
  )
    throw new HttpError(
      403,
      "A valid Updates publish token is required.",
      "publisher_required",
    );
  return "updates-bearer";
}

export async function publishUpdate(context: RouteContext) {
  const input = bodyOf(context.event);
  const now = new Date();
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const entry = validateUpdateEntry({
    ...input,
    id:
      typeof input.id === "string" && input.id.trim()
        ? input.id.trim()
        : updateId(title, now),
    publishedAt:
      typeof input.publishedAt === "string" && input.publishedAt.trim()
        ? input.publishedAt.trim()
        : now.toISOString(),
    title,
  });
  const result = await context.repository.publishUpdate(
    entry,
    publisherPrincipal(context),
  );
  return json(result.created ? 201 : 200, result);
}
