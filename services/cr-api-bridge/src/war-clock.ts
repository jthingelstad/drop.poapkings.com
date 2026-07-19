import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import type {
  ClanWarPeriodType,
  CrWarClockResult,
} from "@elixir-drop/contracts";

type BridgeFetch = typeof fetch;

const RESET_HOUR_UTC = 10;
const DAY_MS = 24 * 60 * 60 * 1_000;
const TAG_PATTERN = /^#[0289PYLQGRJCUV]{3,15}$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new Error(`Clash Royale returned an invalid ${label}`);
  return Number(value);
}

function periodType(value: unknown): ClanWarPeriodType {
  if (value === "training" || value === "trainingDay") return "training";
  if (value === "warDay" || value === "battleDay") return "warDay";
  if (value === "colosseum") return "colosseum";
  throw new Error("Clash Royale returned an unknown Clan Wars period type");
}

function parseCrDate(value: unknown): Date {
  if (typeof value !== "string")
    throw new Error("Clash Royale returned an invalid river-race timestamp");
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.(\d{3})Z$/.exec(
    value,
  );
  if (!match)
    throw new Error("Clash Royale returned an invalid river-race timestamp");
  const [, year, month, day, hour, minute, second, millisecond] = match;
  const parsed = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      Number(millisecond),
    ),
  );
  if (!Number.isFinite(parsed.getTime()))
    throw new Error("Clash Royale returned an invalid river-race timestamp");
  return parsed;
}

// The daily war reset drifts per season (observed 09:56 in S130, 09:37 in
// S131), so anchor period math on the latest river-race close time when one is
// available and fall back to the historical 10:00 UTC otherwise.
function seasonStartAt(
  observedAt: Date,
  periodIndex: number,
  anchor?: Date,
): Date {
  const currentPeriodStart = new Date(
    Date.UTC(
      observedAt.getUTCFullYear(),
      observedAt.getUTCMonth(),
      observedAt.getUTCDate(),
      anchor?.getUTCHours() ?? RESET_HOUR_UTC,
      anchor?.getUTCMinutes() ?? 0,
    ),
  );
  if (observedAt.getTime() < currentPeriodStart.getTime())
    currentPeriodStart.setUTCDate(currentPeriodStart.getUTCDate() - 1);
  return new Date(currentPeriodStart.getTime() - periodIndex * DAY_MS);
}

async function getJson(
  url: string,
  apiKey: string,
  fetcher: BridgeFetch,
): Promise<unknown> {
  const response = await fetcher(url, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      "user-agent": "Elixir-Drop-CR-Bridge/1.0",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`Clash Royale API returned HTTP ${response.status}`);
  return response.json();
}

export async function fetchWarClock(
  clanTag: string,
  apiKey: string,
  fetcher: BridgeFetch = fetch,
  observedAt = new Date(),
): Promise<CrWarClockResult> {
  const normalizedTag = clanTag.trim().toUpperCase();
  if (!TAG_PATTERN.test(normalizedTag))
    throw new Error("Clan Wars clock source tag is invalid");
  const encodedTag = encodeURIComponent(normalizedTag);
  const [currentValue, logValue] = await Promise.all([
    getJson(
      `https://api.clashroyale.com/v1/clans/${encodedTag}/currentriverrace`,
      apiKey,
      fetcher,
    ),
    getJson(
      `https://api.clashroyale.com/v1/clans/${encodedTag}/riverracelog?limit=10`,
      apiKey,
      fetcher,
    ),
  ]);
  const current = record(currentValue);
  const log = record(logValue);
  if (!current || !log || !Array.isArray(log.items))
    throw new Error("Clash Royale returned an invalid Clan Wars clock payload");

  const sectionIndex = nonnegativeInteger(
    current.sectionIndex,
    "Clan Wars section index",
  );
  const periodIndex = nonnegativeInteger(
    current.periodIndex,
    "Clan Wars period index",
  );
  // A five-week season has at most 5 sections of 7 periods; a glitched index
  // would back-date the season start by months.
  if (sectionIndex > 5 || periodIndex > 34)
    throw new Error("Clash Royale returned out-of-range Clan Wars indexes");
  const logEntries = log.items
    .map(record)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => ({
      seasonId: nonnegativeInteger(entry.seasonId, "Clan Wars season ID"),
      sectionIndex: nonnegativeInteger(
        entry.sectionIndex,
        "Clan Wars log section index",
      ),
      createdAt: parseCrDate(entry.createdDate),
    }))
    .sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );
  const latest = logEntries[0];
  if (!latest)
    throw new Error("Clash Royale river-race log did not include a season");
  const startsAt = seasonStartAt(observedAt, periodIndex, latest.createdAt);

  // A log close at (or seconds after) the derived season start is the
  // previous season's final race: the current season is one newer. The first
  // legitimate close of the current season lands a full week after its start,
  // so a generous tolerance absorbs anchor drift without ambiguity.
  const boundaryToleranceMs = 6 * 60 * 60 * 1_000;
  const crSeasonId =
    latest.createdAt.getTime() < startsAt.getTime() + boundaryToleranceMs
      ? latest.seasonId + 1
      : latest.seasonId;
  return {
    version: 1,
    type: "war-clock-result",
    clock: {
      crSeasonId,
      sectionIndex,
      periodIndex,
      periodType: periodType(current.periodType),
      seasonStartsAt: startsAt.toISOString(),
      observedAt: observedAt.toISOString(),
      sourceClanTag: normalizedTag,
    },
  };
}

export async function relayWarClock(
  sqs: SQSClient,
  resultQueueUrl: string,
  clanTag: string,
  apiKey: string,
): Promise<CrWarClockResult> {
  const result = await fetchWarClock(clanTag, apiKey);
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: resultQueueUrl,
      MessageBody: JSON.stringify(result),
    }),
  );
  return result;
}
