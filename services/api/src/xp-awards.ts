import {
  arenaForXp,
  BADGE_LIST,
  badgeRungXp,
  DAILY_FEATURED_XP,
  featuredModeForDate,
  PERSONAL_BEST_DAILY_LIMIT,
  PERSONAL_BEST_XP,
  type XpAward,
} from "@elixir-drop/contracts";
import {
  BADGE_COUNTERS_VERSION,
  recordArenaProgress,
  type BadgeCounters,
  type EarnedRung,
} from "./badges.js";
import type { BadgeXpGrant, Repository, XpRunContext } from "./repository.js";
import type { GameMode } from "./types.js";

export async function awardRunBonuses(
  repository: Repository,
  input: {
    sub: string;
    runId: string;
    mode: GameMode;
    score: number;
    completedAt: string;
    personalBest: boolean;
    underReview: boolean;
  },
): Promise<XpAward[]> {
  const awards: XpAward[] = [];
  const run = { runId: input.runId, completedAt: input.completedAt };
  const day = input.completedAt.slice(0, 10);

  if (input.personalBest && !input.underReview) {
    const award: XpAward = {
      source: "personal-best",
      label: "New personal best",
      amount: PERSONAL_BEST_XP,
    };
    if (
      await repository.grantDailyPersonalBestXp(
        input.sub,
        day,
        run,
        award,
        input.completedAt,
        PERSONAL_BEST_DAILY_LIMIT,
      )
    )
      awards.push(award);
  }

  const qualifiesForFeatured =
    input.mode !== "practice" &&
    featuredModeForDate(new Date(input.completedAt)) === input.mode &&
    (input.mode === "surge" || input.mode === "trade" || input.score > 0);
  if (qualifiesForFeatured) {
    const award: XpAward = {
      source: "daily-featured",
      label: "Daily featured game",
      amount: DAILY_FEATURED_XP,
    };
    if (
      await repository.grantXpOnce(
        input.sub,
        `FEATURED#${day}`,
        award,
        input.completedAt,
        run,
        { day, mode: input.mode, runId: input.runId },
      )
    )
      awards.push(award);
  }

  return awards;
}

function earnedBadgeGrants(counters: BadgeCounters): BadgeXpGrant[] {
  return BADGE_LIST.flatMap((definition) => {
    const count = Math.min(
      counters.earned[definition.slug]?.length ?? 0,
      definition.rungs.length,
    );
    return Array.from({ length: count }, (_, rungIndex) => ({
      key: `BADGE#${definition.slug}#${rungIndex}`,
      slug: definition.slug,
      rungIndex,
      amount: badgeRungXp(definition, rungIndex),
    }));
  }).filter((grant) => grant.amount > 0);
}

async function grantMissingBadgeXp(
  repository: Repository,
  sub: string,
  counters: BadgeCounters,
  at: string,
  run?: XpRunContext,
): Promise<number> {
  let awarded = 0;
  for (let retry = 0; retry < 4; retry += 1) {
    const existing = await repository.badgeXpKeys(sub);
    const missing = earnedBadgeGrants(counters).filter(
      (grant) => !existing.has(grant.key),
    );
    if (!missing.length) return awarded;
    const batchSize = run ? 98 : 99;
    let overlapped = false;
    for (let offset = 0; offset < missing.length; offset += batchSize) {
      const batch = missing.slice(offset, offset + batchSize);
      if (!(await repository.grantBadgeXpBatch(sub, batch, at, run))) {
        overlapped = true;
        break;
      }
      awarded += batch.reduce((total, grant) => total + grant.amount, 0);
    }
    if (!overlapped) return awarded;
  }
  throw new Error("Badge XP reconciliation remained busy after retries");
}

// Award every currently earned badge rung, including historical rungs, then
// settle the finite Arena Climber -> badge XP -> arena cascade. Markers make
// this safe to call after every badge rebuild and every season finalization.
export async function settleBadgeXp(
  repository: Repository,
  sub: string,
  initial: BadgeCounters,
  at: string,
  expected: { version: number; updatedAt?: string },
  run?: XpRunContext,
): Promise<{
  counters: BadgeCounters;
  awarded: number;
  newlyEarned: EarnedRung[];
}> {
  let counters = initial;
  let currentExpected = expected;
  let awarded = 0;
  const newlyEarned: EarnedRung[] = [];

  for (let pass = 0; pass < 6; pass += 1) {
    awarded += await grantMissingBadgeXp(repository, sub, counters, at, run);
    const profile = await repository.getProfile(sub);
    if (!profile) throw new Error("Badge XP player profile was not found");
    const arena = arenaForXp(profile.xp ?? 0);
    const advanced = recordArenaProgress(counters, arena, at);
    const arenaChanged =
      advanced.counters.values["arena-climber"] !==
      counters.values["arena-climber"];
    if (!arenaChanged) return { counters, awarded, newlyEarned };

    const saved = await repository.saveBadges(
      sub,
      advanced.counters,
      at,
      currentExpected,
    );
    if (!saved) {
      const concurrent = await repository.getBadges(sub);
      if (!concurrent || concurrent.version !== BADGE_COUNTERS_VERSION)
        throw new Error("Badge XP arena reconciliation lost its badge bag");
      counters = concurrent;
      currentExpected = {
        version: concurrent.version,
        updatedAt: concurrent.updatedAt,
      };
      continue;
    }
    counters = advanced.counters;
    newlyEarned.push(...advanced.newlyEarned);
    currentExpected = { version: counters.version, updatedAt: at };
  }
  throw new Error("Badge XP arena cascade did not settle");
}
