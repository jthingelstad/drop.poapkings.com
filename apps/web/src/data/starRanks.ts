export interface StarRank {
  n: number
  name: string
  slug: string
  // Lifetime Player XP required to reach this arena. XP is an activity score:
  // one point per question practiced (a Surge sprint ≈ 15, a game averages
  // ~12), so early arenas fall within a session and the summit (~5,000 games)
  // is a genuine long-haul. Per-player, and only ever climbs.
  threshold: number
  image: string
}

const RANKS: StarRank[] = [
  { n: 1, name: 'Goblin Stadium', slug: 'goblin-stadium', threshold: 0, image: '/assets/arenas/01-goblin-stadium.png' },
  { n: 2, name: 'Bone Pit', slug: 'bone-pit', threshold: 40, image: '/assets/arenas/02-bone-pit.png' },
  {
    n: 3,
    name: 'Barbarian Bowl',
    slug: 'barbarian-bowl',
    threshold: 100,
    image: '/assets/arenas/03-barbarian-bowl.png'
  },
  { n: 4, name: 'Spell Valley', slug: 'spell-valley', threshold: 200, image: '/assets/arenas/04-spell-valley.png' },
  {
    n: 5,
    name: "Builder's Workshop",
    slug: 'builders-workshop',
    threshold: 350,
    image: '/assets/arenas/05-builders-workshop.png'
  },
  {
    n: 6,
    name: "P.E.K.K.A.'s Playhouse",
    slug: 'pekkas-playhouse',
    threshold: 550,
    image: '/assets/arenas/06-pekkas-playhouse.png'
  },
  { n: 7, name: 'Royal Arena', slug: 'royal-arena', threshold: 800, image: '/assets/arenas/07-royal-arena.png' },
  { n: 8, name: 'Frozen Peak', slug: 'frozen-peak', threshold: 1100, image: '/assets/arenas/08-frozen-peak.png' },
  { n: 9, name: 'Jungle Arena', slug: 'jungle-arena', threshold: 1500, image: '/assets/arenas/09-jungle-arena.png' },
  { n: 10, name: 'Hog Mountain', slug: 'hog-mountain', threshold: 2000, image: '/assets/arenas/10-hog-mountain.png' },
  {
    n: 11,
    name: 'Electro Valley',
    slug: 'electro-valley',
    threshold: 2600,
    image: '/assets/arenas/11-electro-valley.png'
  },
  { n: 12, name: 'Spooky Town', slug: 'spooky-town', threshold: 3300, image: '/assets/arenas/12-spooky-town.png' },
  {
    n: 13,
    name: "Rascal's Hideout",
    slug: 'rascals-hideout',
    threshold: 4200,
    image: '/assets/arenas/13-rascals-hideout.png'
  },
  {
    n: 14,
    name: 'Serenity Peak',
    slug: 'serenity-peak',
    threshold: 5300,
    image: '/assets/arenas/14-serenity-peak.png'
  },
  { n: 15, name: "Miner's Mine", slug: 'miners-mine', threshold: 6600, image: '/assets/arenas/15-miners-mine.png' },
  {
    n: 16,
    name: "Executioner's Kitchen",
    slug: 'executioners-kitchen',
    threshold: 8100,
    image: '/assets/arenas/16-executioners-kitchen.png'
  },
  { n: 17, name: 'Royal Crypt', slug: 'royal-crypt', threshold: 9900, image: '/assets/arenas/17-royal-crypt.png' },
  {
    n: 18,
    name: 'Silent Sanctuary',
    slug: 'silent-sanctuary',
    threshold: 12000,
    image: '/assets/arenas/18-silent-sanctuary.png'
  },
  { n: 19, name: 'Dragon Spa', slug: 'dragon-spa', threshold: 14500, image: '/assets/arenas/19-dragon-spa.png' },
  { n: 20, name: 'Boot Camp', slug: 'boot-camp', threshold: 17400, image: '/assets/arenas/20-boot-camp.png' },
  { n: 21, name: 'Clash Fest', slug: 'clash-fest', threshold: 20800, image: '/assets/arenas/21-clash-fest.png' },
  { n: 22, name: 'PANCAKES!', slug: 'pancakes', threshold: 24800, image: '/assets/arenas/22-pancakes.png' },
  { n: 23, name: 'Valkalla', slug: 'valkalla', threshold: 29500, image: '/assets/arenas/23-valkalla.png' },
  {
    n: 24,
    name: 'Legendary Arena',
    slug: 'legendary-arena',
    threshold: 35000,
    image: '/assets/arenas/24-legendary-arena.png'
  },
  {
    n: 25,
    name: 'Lumberlove Arena',
    slug: 'lumberlove-arena',
    threshold: 41500,
    image: '/assets/arenas/25-lumberlove-arena.png'
  },
  { n: 26, name: 'Royal Road', slug: 'royal-road', threshold: 49000, image: '/assets/arenas/26-royal-road.png' },
  {
    n: 27,
    name: 'Musketeer Street',
    slug: 'musketeer-street',
    threshold: 58000,
    image: '/assets/arenas/27-musketeer-street.png'
  },
  {
    n: 28,
    name: 'Summit of Heroes',
    slug: 'summit-of-heroes',
    threshold: 68000,
    image: '/assets/arenas/28-summit-of-heroes.png'
  }
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

export function zoneFor(count: number, current: StarRank, next: StarRank | null): 'close' | 'just-passed' | 'default' {
  if (next) {
    const bracket = next.threshold - current.threshold
    if (count >= next.threshold - bracket * 0.1) return 'close'
    if (count < current.threshold + bracket * 0.1 && current.threshold > 0) return 'just-passed'
  } else if (current.threshold > 0) {
    return 'just-passed'
  }
  return 'default'
}
