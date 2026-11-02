import { RANKED_GAME_MODES, type RankedGameMode } from "@elixir-drop/contracts";
import { HttpError } from "./errors.js";
import { validateUpdateEntry, type UpdateEntry } from "./player-updates.js";
import type { Repository } from "./repository.js";

// Drop's two automatic season posts (Jamie, 2026-11-02): an opening bell and a
// final-results post each season, from fixed templates over the public boards,
// naming each game's #1 at the close. There is no weekly standings post, no
// model, and no player text beyond the public display name.
//
// Exactly once, durably: finalization freezes the closing boards into one
// SEASON_POSTS record (first write wins) before the clock advances. Every
// war-clock job then publishes whatever that record still owes, under a
// deterministic Update id per season and kind, so a retried or duplicated job
// can only ever find the post already there.

export const SEASON_POST_KINDS = ["final-results", "opening-bell"] as const;
export type SeasonPostKind = (typeof SEASON_POST_KINDS)[number];

export const SEASON_POSTS_PUBLISHER = "season-posts";

export interface SeasonPostLeader {
  mode: RankedGameMode;
  publicName: string;
  score: number;
}

export interface SeasonPostsRecord {
  closedSeasonId: number;
  openingSeasonId: number;
  // When the season closed: the observation that finalized it.
  closedAt: string;
  openingSeasonEndsAt?: string;
  // Each ranked game's public #1 as the board stood at the close. A game with
  // no ranked run that season has no entry.
  leaders: SeasonPostLeader[];
  posted: Partial<Record<SeasonPostKind, string>>;
}

const MODE_NAMES: Record<RankedGameMode, string> = {
  surge: "Surge",
  "higher-lower": "Higher / Lower",
  trade: "Trade",
  survival: "Survival",
  rain: "Rain",
};

// The game's normal score formatting, mirroring the browser's `scoreLabel`
// (apps/web/src/lib/game-metadata.ts): timed games to the millisecond.
export function seasonPostScore(mode: RankedGameMode, score: number): string {
  if (mode === "surge" || mode === "trade")
    return `${(score / 1000).toFixed(3)}s`;
  if (mode === "rain") return `${Math.round(score)} cleared`;
  if (mode === "higher-lower") return `${Math.round(score)} correct`;
  return `${Math.round(score)} streak`;
}

// A display name is player-chosen data inside our Markdown. Escape every ASCII
// punctuation mark (CommonMark's escapable set) so nothing in a name can open
// emphasis, code, a link, strikethrough, or an autolink. Angle brackets are
// dropped instead: the Updates validator refuses anything that looks like a
// tag, escaped or not.
export function escapeDisplayName(name: string): string {
  const cleaned = name
    .replace(/\s+/g, " ")
    .replace(/[\p{Cc}<>]/gu, "")
    .trim();
  return (cleaned || "Elixir Player").replace(
    /[!-/:-@[-`{-~]/g,
    (character) => `\\${character}`,
  );
}

function joinNames(names: string[]): string {
  if (names.length <= 2) return names.join(" or ");
  return `${names.slice(0, -1).join(", ")}, or ${names.at(-1)}`;
}

function seasonEndLabel(endsAt: string | undefined): string | undefined {
  if (!endsAt || !Number.isFinite(Date.parse(endsAt))) return undefined;
  // Seasons turn over at 10:00 UTC, the same calendar day in US Central.
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
  }).format(new Date(endsAt));
}

export function seasonPostId(kind: SeasonPostKind, seasonId: number): string {
  return `season-${seasonId}-${kind}`;
}

function entry(
  kind: SeasonPostKind,
  seasonId: number,
  publishedAt: string,
  title: string,
  body: string,
): UpdateEntry {
  return validateUpdateEntry({
    id: seasonPostId(kind, seasonId),
    kind: "season",
    publishedAt,
    title,
    body,
  });
}

export function renderFinalResults(
  record: Pick<SeasonPostsRecord, "closedSeasonId" | "leaders">,
  publishedAt: string,
): UpdateEntry {
  const season = record.closedSeasonId;
  const link = `[See the final boards](/#/leaderboards?season=${season}).`;
  const byMode = new Map(record.leaders.map((leader) => [leader.mode, leader]));
  const leaders = RANKED_GAME_MODES.flatMap((mode) => {
    const leader = byMode.get(mode);
    return leader ? [{ ...leader, mode }] : [];
  });
  if (!leaders.length)
    return entry(
      "final-results",
      season,
      publishedAt,
      `Season ${season} closed with empty boards`,
      `Season ${season} closed with all five boards empty. Nobody posted a ranked run, so nobody gets the bragging rights. ${link}`,
    );

  const lines = leaders.map(
    (leader) =>
      `${MODE_NAMES[leader.mode]}: ${escapeDisplayName(leader.publicName)} at **${seasonPostScore(leader.mode, leader.score)}**.`,
  );
  const empty = RANKED_GAME_MODES.filter((mode) => !byMode.has(mode));
  const emptyLine = empty.length
    ? ` Nobody posted a ranked ${joinNames(empty.map((mode) => MODE_NAMES[mode]))} run.`
    : "";
  return entry(
    "final-results",
    season,
    publishedAt,
    `Season ${season} is final`,
    `Season ${season} is in the books. ${lines.join(" ")}${emptyLine} Bragging rights are official. ${link}`,
  );
}

export function renderOpeningBell(
  record: Pick<SeasonPostsRecord, "openingSeasonId" | "openingSeasonEndsAt">,
  publishedAt: string,
): UpdateEntry {
  const season = record.openingSeasonId;
  const endsOn = seasonEndLabel(record.openingSeasonEndsAt);
  return entry(
    "opening-bell",
    season,
    publishedAt,
    `Season ${season} is open`,
    `Season ${season} is open. Surge, Higher / Lower, Trade, Survival, and Rain all start from zero${endsOn ? ` and close ${endsOn}` : ""}. Last season's #1s start there too. [Check the boards](/#/leaderboards).`,
  );
}

export function renderSeasonPost(
  kind: SeasonPostKind,
  record: SeasonPostsRecord,
  publishedAt: string,
): UpdateEntry {
  return kind === "final-results"
    ? renderFinalResults(record, publishedAt)
    : renderOpeningBell(record, publishedAt);
}

// Read each ranked game's public #1 at the close. This is the same read
// GET /leaderboards serves, so excluded runs are already off it.
export async function closingLeaders(
  repository: Pick<Repository, "leaderboard">,
  seasonId: number,
): Promise<SeasonPostLeader[]> {
  const boards = await Promise.all(
    RANKED_GAME_MODES.map(async (mode) => ({
      mode,
      top: (await repository.leaderboard(mode, seasonId, 1))[0],
    })),
  );
  return boards.flatMap(({ mode, top }) => {
    const score = Number(top?.score);
    if (!top || !Number.isFinite(score)) return [];
    const player = top.player as { publicName?: unknown } | undefined;
    return [
      {
        mode,
        publicName:
          typeof player?.publicName === "string"
            ? player.publicName
            : "Elixir Player",
        score,
      },
    ];
  });
}

// Called by finalization before the clock advances. The record is created
// once; a retried finalization keeps the first snapshot, so a late post still
// shows the boards as they stood at the close.
export async function recordSeasonPosts(
  repository: Pick<Repository, "leaderboard" | "createSeasonPosts">,
  closing: {
    closedSeasonId: number;
    openingSeasonId: number;
    closedAt: string;
    openingSeasonEndsAt?: string;
  },
): Promise<boolean> {
  return repository.createSeasonPosts({
    ...closing,
    leaders: await closingLeaders(repository, closing.closedSeasonId),
    posted: {},
  });
}

function isUpdateConflict(error: unknown): boolean {
  return error instanceof HttpError && error.code === "update_conflict";
}

// Publishes whatever a season record still owes. It never throws: a failed post
// leaves the record pending, and the next hourly war-clock job tries again.
// Final results always land before that season's opening bell.
export async function publishPendingSeasonPosts(
  repository: Pick<
    Repository,
    "pendingSeasonPosts" | "publishUpdate" | "markSeasonPostPublished"
  >,
  now: () => Date = () => new Date(),
): Promise<number> {
  let published = 0;
  let pending: SeasonPostsRecord[];
  try {
    pending = await repository.pendingSeasonPosts();
  } catch (error) {
    console.error({
      event: "season-post.failed",
      error: error instanceof Error ? error.name : "unknown",
    });
    return 0;
  }
  for (const record of pending) {
    for (const kind of SEASON_POST_KINDS) {
      if (record.posted[kind]) continue;
      const seasonId =
        kind === "final-results"
          ? record.closedSeasonId
          : record.openingSeasonId;
      try {
        const update = renderSeasonPost(kind, record, now().toISOString());
        let created = false;
        try {
          created = (
            await repository.publishUpdate(update, SEASON_POSTS_PUBLISHER)
          ).created;
        } catch (error) {
          // The id is deterministic per season and kind, so an entry already
          // holding it means an earlier attempt landed (its timestamp
          // differs). That is the post; never write a second one.
          if (!isUpdateConflict(error)) throw error;
        }
        if (created) published += 1;
        await repository.markSeasonPostPublished(
          record.closedSeasonId,
          kind,
          now().toISOString(),
        );
        console.info({ event: "season-post.published", kind, seasonId });
      } catch (error) {
        console.error({
          event: "season-post.failed",
          kind,
          seasonId,
          error: error instanceof Error ? error.name : "unknown",
        });
        break;
      }
    }
  }
  return published;
}
