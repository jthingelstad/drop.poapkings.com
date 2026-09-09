export const UPDATE_KINDS = ["feature", "season", "message"] as const;
export type UpdateKind = (typeof UPDATE_KINDS)[number];

export const UPDATE_IMPACTS = [
  "gameplay",
  "learning",
  "competition",
  "progression",
  "access",
  "sharing",
  "identity",
  "account-privacy",
] as const;
export type UpdateImpact = (typeof UPDATE_IMPACTS)[number];

export const MAX_UPDATE_TITLE_CHARACTERS = 55;
export const MAX_UPDATE_BODY_WORDS = 60;
export const MAX_UPDATE_ENTRIES = 500;

export interface UpdateEntry {
  id: string;
  kind: UpdateKind;
  impact?: UpdateImpact;
  publishedAt: string;
  title: string;
  body: string;
}

const UPDATE_KIND_SET = new Set<string>(UPDATE_KINDS);
const UPDATE_IMPACT_SET = new Set<string>(UPDATE_IMPACTS);
const UPDATE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;

function stringField(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${name} is required`);
  return value.trim();
}

export function isUpdateTimestamp(value: string): boolean {
  return ISO_DATE_TIME.test(value) && !Number.isNaN(Date.parse(value));
}

export function safeUpdateHref(href: string): string | undefined {
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  if (href.startsWith("#")) return href;
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "mailto:"
      ? href
      : undefined;
  } catch {
    return undefined;
  }
}

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

function closingMarker(value: string, marker: string, from: number): number {
  let cursor = from;
  while (cursor < value.length) {
    const found = value.indexOf(marker, cursor);
    if (found === -1) return -1;
    let slashes = 0;
    for (let index = found - 1; index >= 0 && value[index] === "\\"; index -= 1)
      slashes += 1;
    if (slashes % 2 === 0) return found;
    cursor = found + marker.length;
  }
  return -1;
}

// Updates deliberately support only inline emphasis, strong text, code, and
// safe links. This small renderer is also the server-side validator for the
// public archive and RSS; unsupported block Markdown and raw HTML fail closed.
export function renderUpdateMarkdownHtml(body: string): string {
  if (/\r|\n/.test(body))
    throw new Error("Update copy must be exactly one paragraph");
  if (
    /^\s*(?:#{1,6}\s|>|[-+*]\s|\d+[.)]\s|```|~~~|(?:---|___|\*\*\*)\s*$)/.test(
      body,
    )
  )
    throw new Error("Markdown element is not supported in update copy");
  if (/<\/?[A-Za-z!]/.test(body))
    throw new Error("Raw HTML is not supported in update copy");
  if (body.includes("!["))
    throw new Error("Images are not supported in update copy");

  let html = "";
  let text = "";
  const flush = () => {
    html += escapeHtml(text);
    text = "";
  };

  for (let index = 0; index < body.length;) {
    if (body[index] === "\\" && index + 1 < body.length) {
      text += body[index + 1];
      index += 2;
      continue;
    }
    if (body.startsWith("**", index)) {
      const end = closingMarker(body, "**", index + 2);
      if (end !== -1) {
        flush();
        html += `<strong>${renderUpdateMarkdownHtml(body.slice(index + 2, end))}</strong>`;
        index = end + 2;
        continue;
      }
    }
    if (body[index] === "*") {
      const end = closingMarker(body, "*", index + 1);
      if (end !== -1) {
        flush();
        html += `<em>${renderUpdateMarkdownHtml(body.slice(index + 1, end))}</em>`;
        index = end + 1;
        continue;
      }
    }
    if (body[index] === "`") {
      const end = closingMarker(body, "`", index + 1);
      if (end !== -1) {
        flush();
        html += `<code>${escapeHtml(body.slice(index + 1, end))}</code>`;
        index = end + 1;
        continue;
      }
    }
    if (body[index] === "[") {
      const labelEnd = closingMarker(body, "]", index + 1);
      if (labelEnd !== -1 && body[labelEnd + 1] === "(") {
        const hrefEnd = closingMarker(body, ")", labelEnd + 2);
        if (hrefEnd !== -1) {
          const href = body.slice(labelEnd + 2, hrefEnd).trim();
          const safeHref = safeUpdateHref(href);
          if (!safeHref)
            throw new Error(`Link uses an unsupported destination: ${href}`);
          flush();
          const external = safeHref.startsWith("https://");
          html += `<a href="${escapeHtml(safeHref)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${renderUpdateMarkdownHtml(body.slice(index + 1, labelEnd))}</a>`;
          index = hrefEnd + 1;
          continue;
        }
      }
    }
    text += body[index];
    index += 1;
  }
  flush();
  return html;
}

export function validateUpdateEntry(value: unknown): UpdateEntry {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Update must be an object");
  const input = value as Record<string, unknown>;
  const id = stringField(input.id, "Update id");
  const kind = stringField(input.kind, "Update kind");
  const publishedAt = stringField(input.publishedAt, "Published timestamp");
  const title = stringField(input.title, "Update title");
  const body = stringField(input.body, "Update body");

  if (id.length > 96 || !UPDATE_ID_PATTERN.test(id))
    throw new Error("Update id must be a lowercase kebab-case value");
  if (!UPDATE_KIND_SET.has(kind)) throw new Error("Choose a valid update kind");
  if (!isUpdateTimestamp(publishedAt))
    throw new Error("Published timestamp must be an ISO date-time");
  if (title.length > MAX_UPDATE_TITLE_CHARACTERS)
    throw new Error(
      `Update title must be ${MAX_UPDATE_TITLE_CHARACTERS} characters or fewer`,
    );
  if (body.split(/\s+/).length > MAX_UPDATE_BODY_WORDS)
    throw new Error(
      `Update body must be ${MAX_UPDATE_BODY_WORDS} words or fewer`,
    );

  const impact =
    typeof input.impact === "string" && input.impact.trim()
      ? input.impact.trim()
      : undefined;
  if (kind === "feature" && (!impact || !UPDATE_IMPACT_SET.has(impact)))
    throw new Error("Feature update needs a player-impact category");
  if (kind !== "feature" && impact !== undefined)
    throw new Error("Only feature updates carry player-impact categories");

  renderUpdateMarkdownHtml(body);
  return {
    id,
    kind: kind as UpdateKind,
    ...(impact ? { impact: impact as UpdateImpact } : {}),
    publishedAt,
    title,
    body,
  };
}

export function updateId(title: string, date = new Date()): string {
  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72)
    .replace(/-$/g, "");
  if (!slug) throw new Error("Update title must contain a letter or number");
  return `${date.toISOString().slice(0, 10)}-${slug}`;
}
