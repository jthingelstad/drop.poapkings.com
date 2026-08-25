import {
  arenaForXp,
  GAME_MODES,
  SEASON_CIRCUIT_XP,
  seasonPlacementXp,
  XP_FIRST_SEASON_ID,
  type XpAward,
} from "@elixir-drop/contracts";
import {
  BADGE_COUNTERS_VERSION,
  migrateBadgeCounters,
  recomputeCounters,
  recordPodiumFinish,
  type BadgeCounters,
} from "./badges.js";
import { isGameMode } from "./games.js";
import type { Repository, StoredBadgeCounters } from "./repository.js";
import type { GameMode } from "./types.js";
import { settleBadgeXp } from "./xp-awards.js";

const RANKED_MODES = GAME_MODES.filter(
  (mode): mode is Exclude<GameMode, "practice"> => mode !== "practice",
);
const MAX_BADGE_WRITE_ATTEMPTS = 4;

export interface PodiumFinalization {
  seasonId: number;
  finalizedAt: string;
}

export interface PodiumFinalizationSummary {
  seasonId: number;
  finishes: number;
  awarded: number;
  duplicates: number;
  placementAwards: number;
  placementDuplicates: number;
  circuitAwards: number;
  circuitDuplicates: number;
  xpAwarded: number;
}

async function baselineCounters(
  repository: Repository,
  sub: string,
  stored: StoredBadgeCounters | undefined,
  at: string,
): Promise<BadgeCounters> {
  if (stored?.version === BADGE_COUNTERS_VERSION) return stored;
  const [profile, runs, cardStats] = await Promise.all([
    repository.getProfile(sub),
    repository.listAllRuns(sub),
    repository.getCardStats(sub),
  ]);
  if (!profile) throw new Error("Podium finisher has no player profile");
  const currentRuns = runs.filter(
    (run): run is typeof run & { mode: GameMode } => isGameMode(run.mode),
  );
  if (
    stored &&
    (stored.version === 1 ||
      stored.version === 2 ||
      stored.version === 3 ||
      stored.version === 4 ||
      stored.version === 5 ||
      stored.version === 6)
  )
    return migrateBadgeCounters(stored, currentRuns, at);
  return stored
    ? stored
    : recomputeCounters(
        currentRuns,
        cardStats,
        { totalGames: profile.totalGames, xp: profile.xp ?? 0 },
        arenaForXp,
        at,
      );
}

async function awardFinish(
  repository: Repository,
  sub: string,
  seasonId: number,
  mode: GameMode,
  at: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_BADGE_WRITE_ATTEMPTS; attempt += 1) {
    const stored = await repository.getBadges(sub);
    const baseline = await baselineCounters(repository, sub, stored, at);
    const { counters } = recordPodiumFinish(baseline, at);
    const updatedAt = new Date().toISOString();
    try {
      const saved = await repository.savePodiumAward(
        sub,
        seasonId,
        mode,
        counters,
        at,
        updatedAt,
        stored
          ? { version: stored.version, updatedAt: stored.updatedAt }
          : undefined,
      );
      if (saved)
        await settleBadgeXp(repository, sub, counters, at, {
          version: counters.version,
          updatedAt,
        });
      return saved;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.name !== "TransactionCanceledException" ||
        attempt === MAX_BADGE_WRITE_ATTEMPTS - 1
      )
        throw error;
    }
  }
  return false;
}

export async function finalizePodiumBadges(
  repository: Repository,
  finalization: PodiumFinalization,
): Promise<PodiumFinalizationSummary> {
  const standings = await Promise.all(
    RANKED_MODES.map(async (mode) => ({
      mode,
      finalists: await repository.seasonFinalists(
        mode,
        finalization.seasonId,
        2_000,
      ),
    })),
  );
  const modesByPlayer = new Map<string, GameMode[]>();
  for (const { mode, finalists } of standings) {
    for (const { sub } of finalists.slice(0, 3)) {
      const modes = modesByPlayer.get(sub) ?? [];
      modes.push(mode);
      modesByPlayer.set(sub, modes);
    }
  }

  let placementAwards = 0;
  let placementDuplicates = 0;
  let circuitAwards = 0;
  let circuitDuplicates = 0;
  let xpAwarded = 0;
  const xpSeason = finalization.seasonId >= XP_FIRST_SEASON_ID;
  if (xpSeason) {
    for (const { mode, finalists } of standings) {
      for (const { sub, rank } of finalists.slice(0, 20)) {
        const amount = seasonPlacementXp(rank);
        if (!amount) continue;
        const award: XpAward = {
          source: "season-placement",
          label: `${mode} season #${rank}`,
          amount,
        };
        if (
          await repository.grantXpOnce(
            sub,
            `SEASON-PLACEMENT#${finalization.seasonId}#${mode}`,
            award,
            finalization.finalizedAt,
            undefined,
            { seasonId: finalization.seasonId, mode, rank },
          )
        ) {
          placementAwards += 1;
          xpAwarded += amount;
        } else placementDuplicates += 1;
      }
    }
  }

  const participation = new Map<string, Set<GameMode>>();
  for (const { mode, finalists } of standings) {
    for (const { sub } of finalists) {
      const modes = participation.get(sub) ?? new Set<GameMode>();
      modes.add(mode);
      participation.set(sub, modes);
    }
  }
  for (const [sub, modes] of xpSeason ? participation : []) {
    if (modes.size !== RANKED_MODES.length) continue;
    const award: XpAward = {
      source: "season-circuit",
      label: "Seasonal Circuit",
      amount: SEASON_CIRCUIT_XP,
    };
    if (
      await repository.grantXpOnce(
        sub,
        `SEASON-CIRCUIT#${finalization.seasonId}`,
        award,
        finalization.finalizedAt,
        undefined,
        { seasonId: finalization.seasonId },
      )
    ) {
      circuitAwards += 1;
      xpAwarded += SEASON_CIRCUIT_XP;
    } else circuitDuplicates += 1;
  }

  let awarded = 0;
  let duplicates = 0;
  await Promise.all(
    [...modesByPlayer].map(async ([sub, modes]) => {
      // One player can place in several modes. Keep their badge writes ordered
      // while different players finalize concurrently.
      for (const mode of modes) {
        if (
          await awardFinish(
            repository,
            sub,
            finalization.seasonId,
            mode,
            finalization.finalizedAt,
          )
        )
          awarded += 1;
        else duplicates += 1;
      }
    }),
  );
  return {
    seasonId: finalization.seasonId,
    finishes: awarded + duplicates,
    awarded,
    duplicates,
    placementAwards,
    placementDuplicates,
    circuitAwards,
    circuitDuplicates,
    xpAwarded,
  };
}

export async function finalizePreviousSeasonIfNeeded(
  repository: Repository,
  incoming: { crSeasonId: number; observedAt: string },
): Promise<PodiumFinalizationSummary | undefined> {
  const current = await repository.getCrWarClock();
  if (
    !current ||
    current.crSeasonId === incoming.crSeasonId ||
    Date.parse(incoming.observedAt) <= Date.parse(current.observedAt)
  )
    return undefined;
  return finalizePodiumBadges(repository, {
    seasonId: current.crSeasonId,
    finalizedAt: incoming.observedAt,
  });
}
