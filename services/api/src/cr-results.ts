import type {
  ClashRoyaleAccountAge,
  ClashRoyaleCard,
  ClashRoyaleClan,
  CrPlayerRefreshResult,
  CrPlayerSnapshot,
  CrWarClockResult,
} from "@elixir-drop/contracts";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { getConfig } from "./config.js";
import { Repository } from "./repository.js";

const TAG_PATTERN = /^#[0289PYLQGRJCUV]{3,15}$/;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maxLength = 100): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength)
    throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function isoDate(value: unknown, label: string): string {
  const result = text(value, label, 40);
  if (!Number.isFinite(Date.parse(result)))
    throw new Error(`${label} must be an ISO date`);
  return result;
}

function nonnegativeInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new Error(`${label} must be a nonnegative integer`);
  return Number(value);
}

function parseClan(value: unknown): ClashRoyaleClan | undefined {
  if (value === undefined) return undefined;
  const source = object(value, "Clan");
  const tag = text(source.tag, "Clan tag", 20);
  if (!TAG_PATTERN.test(tag)) throw new Error("Clan tag is invalid");
  const badgeId = nonnegativeInteger(source.badgeId, "Clan badge ID");
  if (badgeId === undefined) throw new Error("Clan badge ID is required");
  return {
    tag,
    name: text(source.name, "Clan name", 100),
    badgeId,
    ...(source.role === undefined
      ? {}
      : { role: text(source.role, "Clan role", 30) }),
  };
}

function parseAccountAge(value: unknown): ClashRoyaleAccountAge | undefined {
  if (value === undefined) return undefined;
  const source = object(value, "Account age");
  const days = nonnegativeInteger(source.days, "Account age days");
  const age = {
    days,
    years:
      days === undefined
        ? nonnegativeInteger(source.years, "Account age years")
        : Math.floor(days / 365),
  };
  return age.days === undefined && age.years === undefined ? undefined : age;
}

function parseCard(value: unknown): ClashRoyaleCard {
  const source = object(value, "Card");
  const id = nonnegativeInteger(source.id, "Card ID");
  if (id === undefined) throw new Error("Card ID is required");
  const iconUrl =
    source.iconUrl === undefined
      ? undefined
      : text(source.iconUrl, "Card icon URL", 1_000);
  if (iconUrl && !iconUrl.startsWith("https://"))
    throw new Error("Card icon URL must use HTTPS");
  return {
    id,
    name: text(source.name, "Card name", 100),
    ...(iconUrl ? { iconUrl } : {}),
  };
}

function parsePlayer(value: unknown): CrPlayerSnapshot {
  const source = object(value, "Player");
  if (!Array.isArray(source.cards) || source.cards.length > 200)
    throw new Error("Player cards must be an array of at most 200 cards");
  const cards = source.cards.map(parseCard);
  if (new Set(cards.map((card) => card.id)).size !== cards.length)
    throw new Error("Player cards must have unique IDs");
  return {
    name: text(source.name, "Player name", 100),
    clan: parseClan(source.clan),
    accountAge: parseAccountAge(source.accountAge),
    cards,
  };
}

export function parseCrPlayerResult(value: unknown): CrPlayerRefreshResult {
  const source = object(value, "Result");
  if (source.version !== 1 || source.type !== "player-result")
    throw new Error("Unsupported CR result message");
  const playerTag = text(source.playerTag, "Player tag", 20);
  if (!TAG_PATTERN.test(playerTag)) throw new Error("Player tag is invalid");
  const base = {
    version: 1 as const,
    type: "player-result" as const,
    jobId: text(source.jobId, "Job ID", 100),
    playerTag,
    requestedAt: isoDate(source.requestedAt, "Requested at"),
    completedAt: isoDate(source.completedAt, "Completed at"),
  };
  if (source.outcome === "not_found") return { ...base, outcome: "not_found" };
  if (source.outcome !== "success")
    throw new Error("CR result outcome is invalid");
  return { ...base, outcome: "success", player: parsePlayer(source.player) };
}

export function parseCrWarClockResult(value: unknown): CrWarClockResult {
  const source = object(value, "Result");
  if (source.version !== 1 || source.type !== "war-clock-result")
    throw new Error("Unsupported CR result message");
  const clock = object(source.clock, "War clock");
  const crSeasonId = nonnegativeInteger(clock.crSeasonId, "CR season ID");
  const sectionIndex = nonnegativeInteger(
    clock.sectionIndex,
    "War clock section index",
  );
  const periodIndex = nonnegativeInteger(
    clock.periodIndex,
    "War clock period index",
  );
  if (crSeasonId === undefined || crSeasonId === 0)
    throw new Error("CR season ID is required");
  if (sectionIndex === undefined || periodIndex === undefined)
    throw new Error("War clock indexes are required");
  // A five-week season has at most 5 sections of 7 periods. A glitched index
  // (e.g. periodIndex 500) would back-date seasonStartsAt by over a year and
  // silently rewrite the leaderboard season, so bound both.
  if (sectionIndex > 5 || periodIndex > 34)
    throw new Error("War clock indexes are out of range");
  if (
    clock.periodType !== "training" &&
    clock.periodType !== "warDay" &&
    clock.periodType !== "colosseum"
  )
    throw new Error("War clock period type is invalid");
  const seasonStartsAt = isoDate(
    clock.seasonStartsAt,
    "War clock season start",
  );
  const observedAt = isoDate(clock.observedAt, "War clock observation");
  if (Date.parse(seasonStartsAt) > Date.parse(observedAt))
    throw new Error("War clock season start is after its observation");
  const sourceClanTag = text(clock.sourceClanTag, "War clock clan tag", 20);
  if (!TAG_PATTERN.test(sourceClanTag))
    throw new Error("War clock clan tag is invalid");
  return {
    version: 1,
    type: "war-clock-result",
    clock: {
      crSeasonId,
      sectionIndex,
      periodIndex,
      periodType: clock.periodType,
      seasonStartsAt,
      observedAt,
      sourceClanTag,
    },
  };
}

export async function saveCrPlayerResult(
  repository: Repository,
  result: CrPlayerRefreshResult,
): Promise<boolean> {
  return repository.saveCrProfileResult({
    tag: result.playerTag,
    status: result.outcome === "success" ? "ready" : "not_found",
    ...(result.outcome === "success" ? result.player : {}),
    fetchedAt: result.completedAt,
    refreshRequestedAt: result.requestedAt,
    updatedAt: result.completedAt,
  });
}

export async function saveCrWarClockResult(
  repository: Repository,
  result: CrWarClockResult,
): Promise<boolean> {
  return repository.saveCrWarClock(result.clock);
}

export async function crResultHandler(
  event: SQSEvent,
): Promise<SQSBatchResponse> {
  const repository = new Repository(getConfig().tableName);
  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
  for (const record of event.Records) {
    try {
      const value = JSON.parse(record.body) as unknown;
      const type = object(value, "Result").type;
      if (type === "war-clock-result") {
        const result = parseCrWarClockResult(value);
        const saved = await saveCrWarClockResult(repository, result);
        console.info("CR war clock processed", {
          crSeasonId: result.clock.crSeasonId,
          sectionIndex: result.clock.sectionIndex,
          periodIndex: result.clock.periodIndex,
          saved,
        });
      } else {
        const result = parseCrPlayerResult(value);
        const saved = await saveCrPlayerResult(repository, result);
        console.info("CR player result processed", {
          jobId: result.jobId,
          playerTag: result.playerTag,
          outcome: result.outcome,
          saved,
        });
      }
    } catch (error) {
      console.error("CR bridge result failed", {
        messageId: record.messageId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
