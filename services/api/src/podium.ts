import { arenaForXp, GAME_MODES } from "@elixir-drop/contracts";
import {
  BADGE_COUNTERS_VERSION,
  recomputeCounters,
  recordPodiumFinish,
  type BadgeCounters,
} from "./badges.js";
import { isGameMode } from "./games.js";
import type { Repository, StoredBadgeCounters } from "./repository.js";
import type { GameMode } from "./types.js";

const RANKED_MODES = GAME_MODES.filter(
  (mode): mode is Exclude<GameMode, "practice"> => mode !== "practice",
);
const MAX_BADGE_WRITE_ATTEMPTS = 4;

export interface PodiumFinalization {
  seasonId: string;
  finalizedAt: string;
}

export interface PodiumFinalizationSummary {
  seasonId: string;
  finishes: number;
  awarded: number;
  duplicates: number;
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
  return recomputeCounters(
    runs.filter((run): run is typeof run & { mode: GameMode } =>
      isGameMode(run.mode),
    ),
    cardStats,
    { totalGames: profile.totalGames, xp: profile.xp ?? 0 },
    arenaForXp,
    at,
  );
}

async function awardFinish(
  repository: Repository,
  sub: string,
  seasonId: string,
  mode: GameMode,
  at: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_BADGE_WRITE_ATTEMPTS; attempt += 1) {
    const stored = await repository.getBadges(sub);
    const baseline = await baselineCounters(repository, sub, stored, at);
    const { counters } = recordPodiumFinish(baseline, at);
    try {
      return await repository.savePodiumAward(
        sub,
        seasonId,
        mode,
        counters,
        at,
        new Date().toISOString(),
        stored
          ? { version: stored.version, updatedAt: stored.updatedAt }
          : undefined,
      );
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
      subs: await repository.podiumFinishers(mode, finalization.seasonId),
    })),
  );
  const modesByPlayer = new Map<string, GameMode[]>();
  for (const { mode, subs } of standings) {
    for (const sub of subs) {
      const modes = modesByPlayer.get(sub) ?? [];
      modes.push(mode);
      modesByPlayer.set(sub, modes);
    }
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
    seasonId: current.leaderboardSeasonId,
    finalizedAt: incoming.observedAt,
  });
}
