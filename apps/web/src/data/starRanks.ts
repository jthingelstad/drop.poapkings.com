export interface StarRank {
  n: number
  name: string
  slug: string
  // Lifetime Player XP required to reach this arena. XP is an activity score:
  // one point per question practiced (a Surge sprint ≈ 15, a game averages
  // ~12), so early arenas fall within a session and the summit (~5,000 games)
  // is a genuine long-haul. Per-player, and only ever climbs.
  //
  // These values are mirrored by `ARENA_XP_THRESHOLDS` in
  // `@elixir-drop/contracts`, which the server reads to resolve the Arena
  // Climber badge — the browser and the Lambda cannot import each other, so the
  // ladder exists in both places. `tests/unit/trophy-road.test.tsx` asserts the
  // two stay identical; if that test fails, these are the numbers that moved.
  //
  // The arena carries progression through its NAME and the XP bar alone. The
  // rendered arena artwork was removed (2026-08 refresh): it is Supercell's
  // environment art, not clearly covered by the fan-content policy, and it sat
  // as chrome behind numbers that said it better. Badges are the art surface now.
  threshold: number
}

const RANKS: StarRank[] = [
  { n: 1, name: 'Goblin Stadium', slug: 'goblin-stadium', threshold: 0 },
  { n: 2, name: 'Bone Pit', slug: 'bone-pit', threshold: 40 },
  { n: 3, name: 'Barbarian Bowl', slug: 'barbarian-bowl', threshold: 100 },
  { n: 4, name: 'Spell Valley', slug: 'spell-valley', threshold: 200 },
  { n: 5, name: "Builder's Workshop", slug: 'builders-workshop', threshold: 350 },
  { n: 6, name: "P.E.K.K.A.'s Playhouse", slug: 'pekkas-playhouse', threshold: 550 },
  { n: 7, name: 'Royal Arena', slug: 'royal-arena', threshold: 800 },
  { n: 8, name: 'Frozen Peak', slug: 'frozen-peak', threshold: 1100 },
  { n: 9, name: 'Jungle Arena', slug: 'jungle-arena', threshold: 1500 },
  { n: 10, name: 'Hog Mountain', slug: 'hog-mountain', threshold: 2000 },
  { n: 11, name: 'Electro Valley', slug: 'electro-valley', threshold: 2600 },
  { n: 12, name: 'Spooky Town', slug: 'spooky-town', threshold: 3300 },
  { n: 13, name: "Rascal's Hideout", slug: 'rascals-hideout', threshold: 4200 },
  { n: 14, name: 'Serenity Peak', slug: 'serenity-peak', threshold: 5300 },
  { n: 15, name: "Miner's Mine", slug: 'miners-mine', threshold: 6600 },
  { n: 16, name: "Executioner's Kitchen", slug: 'executioners-kitchen', threshold: 8100 },
  { n: 17, name: 'Royal Crypt', slug: 'royal-crypt', threshold: 9900 },
  { n: 18, name: 'Silent Sanctuary', slug: 'silent-sanctuary', threshold: 12000 },
  { n: 19, name: 'Dragon Spa', slug: 'dragon-spa', threshold: 14500 },
  { n: 20, name: 'Boot Camp', slug: 'boot-camp', threshold: 17400 },
  { n: 21, name: 'Clash Fest', slug: 'clash-fest', threshold: 20800 },
  { n: 22, name: 'PANCAKES!', slug: 'pancakes', threshold: 24800 },
  { n: 23, name: 'Valkalla', slug: 'valkalla', threshold: 29500 },
  { n: 24, name: 'Legendary Arena', slug: 'legendary-arena', threshold: 35000 },
  { n: 25, name: 'Lumberlove Arena', slug: 'lumberlove-arena', threshold: 41500 },
  { n: 26, name: 'Royal Road', slug: 'royal-road', threshold: 49000 },
  { n: 27, name: 'Musketeer Street', slug: 'musketeer-street', threshold: 58000 },
  { n: 28, name: 'Summit of Heroes', slug: 'summit-of-heroes', threshold: 68000 }
]

export default RANKS

export function rankFor(count: number) {
  let cur = RANKS[0]
  let next: StarRank | null = null
  for (let i = 0; i < RANKS.length; i++) {
    if (count >= RANKS[i].threshold) {
      cur = RANKS[i]
      next = RANKS[i + 1] ?? null
    } else break
  }
  return { current: cur, next }
}
