export interface StarRank {
  n: number
  name: string
  slug: string
  // Lifetime Player XP required to reach this arena. XP is correctness-weighted
  // (a clean Surge run ≈ 60 XP), so early arenas fall within a session or two
  // and the summit is a genuine long-haul. Re-thresholded from the former
  // games-played basis when Trophy Road became per-player XP.
  threshold: number
  image: string
}

const RANKS: StarRank[] = [
  { n: 1, name: 'Goblin Stadium', slug: 'goblin-stadium', threshold: 0, image: '/assets/arenas/01-goblin-stadium.png' },
  { n: 2, name: 'Bone Pit', slug: 'bone-pit', threshold: 150, image: '/assets/arenas/02-bone-pit.png' },
  {
    n: 3,
    name: 'Barbarian Bowl',
    slug: 'barbarian-bowl',
    threshold: 400,
    image: '/assets/arenas/03-barbarian-bowl.png'
  },
  { n: 4, name: 'Spell Valley', slug: 'spell-valley', threshold: 750, image: '/assets/arenas/04-spell-valley.png' },
  {
    n: 5,
    name: "Builder's Workshop",
    slug: 'builders-workshop',
    threshold: 1200,
    image: '/assets/arenas/05-builders-workshop.png'
  },
  {
    n: 6,
    name: "P.E.K.K.A.'s Playhouse",
    slug: 'pekkas-playhouse',
    threshold: 1800,
    image: '/assets/arenas/06-pekkas-playhouse.png'
  },
  { n: 7, name: 'Royal Arena', slug: 'royal-arena', threshold: 2600, image: '/assets/arenas/07-royal-arena.png' },
  { n: 8, name: 'Frozen Peak', slug: 'frozen-peak', threshold: 3600, image: '/assets/arenas/08-frozen-peak.png' },
  { n: 9, name: 'Jungle Arena', slug: 'jungle-arena', threshold: 4800, image: '/assets/arenas/09-jungle-arena.png' },
  { n: 10, name: 'Hog Mountain', slug: 'hog-mountain', threshold: 6300, image: '/assets/arenas/10-hog-mountain.png' },
  {
    n: 11,
    name: 'Electro Valley',
    slug: 'electro-valley',
    threshold: 8200,
    image: '/assets/arenas/11-electro-valley.png'
  },
  { n: 12, name: 'Spooky Town', slug: 'spooky-town', threshold: 10500, image: '/assets/arenas/12-spooky-town.png' },
  {
    n: 13,
    name: "Rascal's Hideout",
    slug: 'rascals-hideout',
    threshold: 13300,
    image: '/assets/arenas/13-rascals-hideout.png'
  },
  {
    n: 14,
    name: 'Serenity Peak',
    slug: 'serenity-peak',
    threshold: 16700,
    image: '/assets/arenas/14-serenity-peak.png'
  },
  { n: 15, name: "Miner's Mine", slug: 'miners-mine', threshold: 20800, image: '/assets/arenas/15-miners-mine.png' },
  {
    n: 16,
    name: "Executioner's Kitchen",
    slug: 'executioners-kitchen',
    threshold: 25700,
    image: '/assets/arenas/16-executioners-kitchen.png'
  },
  { n: 17, name: 'Royal Crypt', slug: 'royal-crypt', threshold: 31500, image: '/assets/arenas/17-royal-crypt.png' },
  {
    n: 18,
    name: 'Silent Sanctuary',
    slug: 'silent-sanctuary',
    threshold: 38400,
    image: '/assets/arenas/18-silent-sanctuary.png'
  },
  { n: 19, name: 'Dragon Spa', slug: 'dragon-spa', threshold: 46500, image: '/assets/arenas/19-dragon-spa.png' },
  { n: 20, name: 'Boot Camp', slug: 'boot-camp', threshold: 56000, image: '/assets/arenas/20-boot-camp.png' },
  { n: 21, name: 'Clash Fest', slug: 'clash-fest', threshold: 67000, image: '/assets/arenas/21-clash-fest.png' },
  { n: 22, name: 'PANCAKES!', slug: 'pancakes', threshold: 80000, image: '/assets/arenas/22-pancakes.png' },
  { n: 23, name: 'Valkalla', slug: 'valkalla', threshold: 95000, image: '/assets/arenas/23-valkalla.png' },
  {
    n: 24,
    name: 'Legendary Arena',
    slug: 'legendary-arena',
    threshold: 113000,
    image: '/assets/arenas/24-legendary-arena.png'
  },
  {
    n: 25,
    name: 'Lumberlove Arena',
    slug: 'lumberlove-arena',
    threshold: 134000,
    image: '/assets/arenas/25-lumberlove-arena.png'
  },
  { n: 26, name: 'Royal Road', slug: 'royal-road', threshold: 159000, image: '/assets/arenas/26-royal-road.png' },
  {
    n: 27,
    name: 'Musketeer Street',
    slug: 'musketeer-street',
    threshold: 188000,
    image: '/assets/arenas/27-musketeer-street.png'
  },
  {
    n: 28,
    name: 'Summit of Heroes',
    slug: 'summit-of-heroes',
    threshold: 222000,
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
