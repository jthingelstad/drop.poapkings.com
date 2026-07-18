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
  const result = {
    days: nonnegativeInteger(badge.progress),
    years: nonnegativeInteger(badge.level),
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

export async function fetchPlayer(
  request: CrPlayerRefreshRequest,
  apiKey: string,
  fetcher: BridgeFetch = fetch,
): Promise<CrPlayerRefreshResult> {
  const response = await fetcher(
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
  const completedAt = new Date().toISOString();
  const base = {
    version: 1 as const,
    type: "player-result" as const,
    jobId: request.jobId,
    playerTag: request.playerTag,
    requestedAt: request.requestedAt,
    completedAt,
  };
  if (response.status === 404)
    return { ...base, outcome: "not_found" as const };
  if (!response.ok)
    throw new Error(`Clash Royale API returned HTTP ${response.status}`);
  return {
    ...base,
    outcome: "success",
    player: normalizePlayer(await response.json()),
  };
}
