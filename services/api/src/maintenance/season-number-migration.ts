import { seasonNumber } from "@elixir-drop/contracts";

export type SeasonMigrationAction =
  | {
      kind: "update";
      key: { pk: string; sk: string };
      legacySeasonId?: string;
      seasonId?: number;
      legacyGsi1pk?: string;
      gsi1pk?: string;
      removeLeaderboardSeasonId: boolean;
    }
  | {
      kind: "rewrite";
      key: { pk: string; sk: string };
      item: Record<string, unknown>;
      seasonId: number;
      shape: "feed" | "podium" | "xp-placement" | "xp-circuit";
    };

export interface SeasonMigrationPlan {
  action?: SeasonMigrationAction;
  unresolved?: string;
}

const LEGACY_SEASON_PATTERN = /^\d{4}-\d{2}(?:-\d+)?$/;

function legacySeason(
  value: unknown,
): { legacy: string; number: number } | undefined {
  if (typeof value !== "string") return undefined;
  const number = seasonNumber(value);
  if (
    number === undefined ||
    (!LEGACY_SEASON_PATTERN.test(value) && !/^\d+$/.test(value))
  )
    return undefined;
  return { legacy: value, number };
}

function rewrittenKey(
  pk: string,
  sk: string,
):
  | {
      pk: string;
      sk: string;
      seasonId: number;
      shape: "feed" | "podium" | "xp-placement" | "xp-circuit";
    }
  | { unresolved: string }
  | undefined {
  const feed = /^FEED#([^#]+)$/.exec(pk);
  if (feed) {
    const parsed = legacySeason(feed[1]);
    if (!parsed) return { unresolved: "feed key has an invalid season" };
    return {
      pk: `FEED#${parsed.number}`,
      sk,
      seasonId: parsed.number,
      shape: "feed",
    };
  }

  const podium = /^PODIUM#([^#]+)#(.+)$/.exec(sk);
  if (podium) {
    const parsed = legacySeason(podium[1]);
    if (!parsed) return { unresolved: "podium key has an invalid season" };
    return {
      pk,
      sk: `PODIUM#${parsed.number}#${podium[2]}`,
      seasonId: parsed.number,
      shape: "podium",
    };
  }

  const placement = /^XP#SEASON-PLACEMENT#([^#]+)#(.+)$/.exec(sk);
  if (placement) {
    const parsed = legacySeason(placement[1]);
    if (!parsed)
      return { unresolved: "placement XP key has an invalid season" };
    return {
      pk,
      sk: `XP#SEASON-PLACEMENT#${parsed.number}#${placement[2]}`,
      seasonId: parsed.number,
      shape: "xp-placement",
    };
  }

  const circuit = /^XP#SEASON-CIRCUIT#([^#]+)$/.exec(sk);
  if (circuit) {
    const parsed = legacySeason(circuit[1]);
    if (!parsed) return { unresolved: "circuit XP key has an invalid season" };
    return {
      pk,
      sk: `XP#SEASON-CIRCUIT#${parsed.number}`,
      seasonId: parsed.number,
      shape: "xp-circuit",
    };
  }
  return undefined;
}

function rewrittenLeaderboardPartition(
  value: unknown,
): { legacy: string; value: string } | { unresolved: string } | undefined {
  if (typeof value !== "string" || !value.startsWith("LEADERBOARD#"))
    return undefined;
  const match = /^LEADERBOARD#([^#]+)(#.+)$/.exec(value);
  if (!match)
    return { unresolved: "leaderboard partition has an invalid shape" };
  const parsed = legacySeason(match[1]);
  if (!parsed) return undefined;
  return {
    legacy: value,
    value: `LEADERBOARD#${parsed.number}${match[2]}`,
  };
}

export function planSeasonNumberMigration(
  source: Record<string, unknown>,
): SeasonMigrationPlan {
  if (typeof source.pk !== "string" || typeof source.sk !== "string")
    return { unresolved: "item has no string primary key" };

  const key = { pk: source.pk, sk: source.sk };
  const rewrite = rewrittenKey(key.pk, key.sk);
  if (rewrite && "unresolved" in rewrite) return rewrite;

  const season = legacySeason(source.seasonId);
  if (typeof source.seasonId === "string" && !season)
    return { unresolved: "seasonId string cannot be mapped" };

  const gsi = rewrittenLeaderboardPartition(source.GSI1PK);
  if (gsi && "unresolved" in gsi) return gsi;

  if (rewrite) {
    if (season && season.number !== rewrite.seasonId)
      return { unresolved: "embedded key and seasonId disagree" };
    const item: Record<string, unknown> = {
      ...source,
      pk: rewrite.pk,
      sk: rewrite.sk,
      ...(source.seasonId === undefined ? {} : { seasonId: rewrite.seasonId }),
      ...(gsi ? { GSI1PK: gsi.value } : {}),
    };
    delete item.leaderboardSeasonId;
    return {
      action: {
        kind: "rewrite",
        key,
        item,
        seasonId: rewrite.seasonId,
        shape: rewrite.shape,
      },
    };
  }

  const removeLeaderboardSeasonId = source.leaderboardSeasonId !== undefined;
  if (!season && !gsi && !removeLeaderboardSeasonId) return {};
  if (season && gsi && season.number !== seasonNumber(gsi.value.split("#")[1]))
    return { unresolved: "seasonId and leaderboard partition disagree" };
  return {
    action: {
      kind: "update",
      key,
      ...(season
        ? { legacySeasonId: season.legacy, seasonId: season.number }
        : {}),
      ...(gsi ? { legacyGsi1pk: gsi.legacy, gsi1pk: gsi.value } : {}),
      removeLeaderboardSeasonId,
    },
  };
}
