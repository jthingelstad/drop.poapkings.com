import type {
  ClashRoyaleAccountAge,
  ClashRoyaleCard,
  ClashRoyaleClan,
  CrPlayerRefreshRequest,
  CrPlayerRefreshResult,
  CrPlayerSnapshot,
} from "@elixir-drop/contracts";

type BridgeFetch = typeof fetch;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonnegativeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : undefined;
}

function normalizeClan(
  value: unknown,
  roleValue: unknown,
): ClashRoyaleClan | undefined {
  const clan = record(value);
  const badgeId = nonnegativeInteger(clan?.badgeId);
  if (
    typeof clan?.tag !== "string" ||
    typeof clan.name !== "string" ||
    badgeId === undefined
  )
    return undefined;
  return {
    tag: clan.tag,
    name: clan.name,
    badgeId,
    ...(typeof roleValue === "string" && roleValue ? { role: roleValue } : {}),
  };
}

function normalizeAccountAge(
  value: unknown,
): ClashRoyaleAccountAge | undefined {
  if (!Array.isArray(value)) return undefined;
  const badge = value
    .map(record)
    .find((candidate) => candidate?.name === "YearsPlayed");
  if (!badge) return undefined;
  const days = nonnegativeInteger(badge.progress);
  const result = {
    days,
    years:
      days === undefined
        ? nonnegativeInteger(badge.level)
        : Math.floor(days / 365),
  };
  return result.days === undefined && result.years === undefined
    ? undefined
    : result;
}

function normalizeCard(value: unknown): ClashRoyaleCard | undefined {
  const card = record(value);
  const id = nonnegativeInteger(card?.id);
  if (id === undefined || typeof card?.name !== "string" || !card.name)
    return undefined;
  const iconUrls = record(card.iconUrls);
  const iconUrl =
    typeof iconUrls?.medium === "string" &&
    iconUrls.medium.startsWith("https://")
      ? iconUrls.medium
      : undefined;
  return { id, name: card.name, ...(iconUrl ? { iconUrl } : {}) };
}

export function normalizePlayer(value: unknown): CrPlayerSnapshot {
  const player = record(value);
  if (!player || typeof player.name !== "string" || !player.name)
    throw new Error("Clash Royale returned an invalid player payload");
  const cards = Array.isArray(player.cards)
    ? player.cards
        .map(normalizeCard)
        .filter((card): card is ClashRoyaleCard => Boolean(card))
    : [];
  if (!cards.length)
    throw new Error(
      "Clash Royale player payload has no usable card collection",
    );
  return {
    name: player.name,
    clan: normalizeClan(player.clan, player.role),
    accountAge: normalizeAccountAge(player.badges),
    cards: [...new Map(cards.map((card) => [card.id, card])).values()].sort(
      (left, right) => left.name.localeCompare(right.name),
    ),
  };
}

type Delay = (ms: number) => Promise<void>;

const defaultDelay: Delay = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// One transparent retry pass inside the worker, then a clean "unavailable"
// result. Throwing on a CR 429/503 used to burn all five SQS redeliveries in
// minutes and dead-letter the request, stranding the profile in "pending".
const TRANSIENT_ATTEMPTS = 3;

function retryDelayMs(response: Response | undefined, attempt: number): number {
  const retryAfter = Number(response?.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0)
    return Math.min(retryAfter * 1_000, 30_000);
  return 1_000 * 2 ** attempt;
}

export async function fetchPlayer(
  request: CrPlayerRefreshRequest,
  apiKey: string,
  fetcher: BridgeFetch = fetch,
  delay: Delay = defaultDelay,
): Promise<CrPlayerRefreshResult> {
  const base = () => ({
    version: 1 as const,
    type: "player-result" as const,
    jobId: request.jobId,
    playerTag: request.playerTag,
    requestedAt: request.requestedAt,
    completedAt: new Date().toISOString(),
  });
  for (let attempt = 0; attempt < TRANSIENT_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetcher(
        `https://api.clashroyale.com/v1/players/${encodeURIComponent(request.playerTag)}`,
        {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${apiKey}`,
            "user-agent": "Elixir-Drop-CR-Bridge/1.0",
          },
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch {
      // Network failure or timeout.
      if (attempt + 1 < TRANSIENT_ATTEMPTS) {
        await delay(retryDelayMs(undefined, attempt));
        continue;
      }
      return { ...base(), outcome: "unavailable" as const };
    }
    if (response.status === 404)
      return { ...base(), outcome: "not_found" as const };
    if (!response.ok) {
      if (attempt + 1 < TRANSIENT_ATTEMPTS) {
        await delay(retryDelayMs(response, attempt));
        continue;
      }
      console.warn("Clash Royale player fetch gave up", {
        playerTag: request.playerTag,
        status: response.status,
      });
      return { ...base(), outcome: "unavailable" as const };
    }
    try {
      return {
        ...base(),
        outcome: "success",
        player: normalizePlayer(await response.json()),
      };
    } catch (error) {
      // A 200 with an unusable payload is CR-side weirdness, not a poison
      // message; resolve the job instead of dead-lettering it.
      console.warn("Clash Royale player payload was unusable", {
        playerTag: request.playerTag,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return { ...base(), outcome: "unavailable" as const };
    }
  }
  return { ...base(), outcome: "unavailable" as const };
}
