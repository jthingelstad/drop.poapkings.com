export interface AvatarCrop {
  x: number
  y: number
  scale: number
}

// Set by hand in Avatar Crop Studio, one card at a time, with the frame's
// inner edge drawn as a guide — so no crop shows card border. The band centre
// is 0.3214*(y/100)+0.3393 of the image height; a LOWER y crops HIGHER.
const DEFAULT_AVATAR_CROP: AvatarCrop = {
  x: 50,
  y: 48,
  scale: 1.21
}

const AVATAR_CROP_OVERRIDES: Partial<Record<number, Partial<AvatarCrop>>> = {
  // Knight
  26000000: { x: 43, y: 40, scale: 1.39 },
  // Archers
  26000001: { x: 48, y: 47, scale: 1.42 },
  // Goblins
  26000002: { x: 53, y: 40, scale: 1.42 },
  // Giant
  26000003: { x: 46, y: 44, scale: 1.33 },
  // P.E.K.K.A
  26000004: { x: 44, y: 54, scale: 1.33 },
  // Minions
  26000005: { x: 60, y: 39, scale: 1.51 },
  // Balloon
  26000006: { x: 34, y: 69, scale: 1.36 },
  // Witch
  26000007: { x: 44, y: 47, scale: 1.27 },
  // Barbarians
  26000008: { x: 43, y: 46, scale: 1.42 },
  // Golem
  26000009: { y: 38, scale: 1.45 },
  // Skeletons
  26000010: { x: 37, y: 65, scale: 1.3 },
  // Valkyrie
  26000011: { x: 40, y: 49, scale: 1.27 },
  // Skeleton Army
  26000012: { x: 40, y: 46, scale: 1.33 },
  // Bomber
  26000013: { x: 59, y: 63, scale: 1.42 },
  // Musketeer
  26000014: { x: 38, y: 61, scale: 1.33 },
  // Baby Dragon
  26000015: { x: 37, y: 56, scale: 1.39 },
  // Prince
  26000016: { x: 48, y: 48, scale: 1.36 },
  // Wizard
  26000017: { x: 48, y: 56, scale: 1.33 },
  // Mini P.E.K.K.A
  26000018: { x: 47, y: 43, scale: 1.39 },
  // Spear Goblins
  26000019: { x: 54, y: 50, scale: 1.48 },
  // Giant Skeleton
  26000020: { x: 52, y: 44, scale: 1.33 },
  // Hog Rider
  26000021: { x: 51, y: 46, scale: 1.33 },
  // Minion Horde
  26000022: { x: 35, y: 41, scale: 1.39 },
  // Ice Wizard
  26000023: { x: 33, y: 52, scale: 1.48 },
  // Royal Giant
  26000024: { x: 49, y: 47, scale: 1.39 },
  // Guards
  26000025: { x: 45, y: 49, scale: 1.36 },
  // Princess
  26000026: { x: 43, y: 51, scale: 1.37 },
  // Dark Prince
  26000027: { y: 47, scale: 1.29 },
  // Three Musketeers
  26000028: { y: 48, scale: 1.33 },
  // Lava Hound
  26000029: { x: 40, y: 47, scale: 1.37 },
  // Ice Spirit
  26000030: { x: 46, y: 52, scale: 1.29 },
  // Fire Spirit
  26000031: { x: 48, y: 51, scale: 1.35 },
  // Miner
  26000032: { x: 42, y: 56, scale: 1.37 },
  // Sparky
  26000033: { x: 44, y: 47, scale: 1.55 },
  // Bowler
  26000034: { x: 42, y: 53, scale: 1.29 },
  // Lumberjack
  26000035: { x: 41, y: 56, scale: 1.35 },
  // Battle Ram
  26000036: { x: 49, y: 54, scale: 1.33 },
  // Inferno Dragon
  26000037: { x: 33, y: 43, scale: 1.28 },
  // Ice Golem
  26000038: { x: 43, y: 57, scale: 1.35 },
  // Mega Minion
  26000039: { x: 43, y: 51, scale: 1.31 },
  // Dart Goblin
  26000040: { x: 47, y: 52, scale: 1.33 },
  // Goblin Gang
  26000041: { x: 48, y: 48, scale: 1.33 },
  // Electro Wizard
  26000042: { x: 36, y: 63, scale: 1.31 },
  // Elite Barbarians
  26000043: { y: 56, scale: 1.31 },
  // Hunter
  26000044: { x: 37, y: 46, scale: 1.35 },
  // Executioner
  26000045: { x: 49, y: 49, scale: 1.31 },
  // Bandit
  26000046: { x: 40, y: 54, scale: 1.35 },
  // Royal Recruits
  26000047: { x: 47, y: 49, scale: 1.33 },
  // Night Witch
  26000048: { x: 44, y: 58, scale: 1.35 },
  // Bats
  26000049: { x: 43, y: 56, scale: 1.33 },
  // Royal Ghost
  26000050: { x: 37, y: 53, scale: 1.35 },
  // Ram Rider
  26000051: { x: 43, y: 48, scale: 1.35 },
  // Zappies
  26000052: { x: 42, y: 47, scale: 1.35 },
  // Rascals
  26000053: { x: 51, y: 48, scale: 1.31 },
  // Cannon Cart
  26000054: { x: 42, y: 42, scale: 1.29 },
  // Mega Knight
  26000055: { x: 35, y: 44, scale: 1.33 },
  // Skeleton Barrel
  26000056: { x: 42, y: 55, scale: 1.27 },
  // Flying Machine
  26000057: { x: 44, y: 52, scale: 1.29 },
  // Wall Breakers
  26000058: { x: 40, y: 57, scale: 1.33 },
  // Royal Hogs
  26000059: { x: 43, y: 59, scale: 1.31 },
  // Goblin Giant
  26000060: { x: 43, y: 59, scale: 1.29 },
  // Fisherman
  26000061: { x: 41, y: 51, scale: 1.33 },
  // Magic Archer
  26000062: { x: 39, y: 56, scale: 1.37 },
  // Electro Dragon
  26000063: { x: 51, y: 41, scale: 1.33 },
  // Firecracker
  26000064: { y: 61, scale: 1.31 },
  // Mighty Miner
  26000065: { x: 40, y: 57, scale: 1.35 },
  // Elixir Golem
  26000067: { x: 46, y: 58, scale: 1.33 },
  // Battle Healer
  26000068: { x: 48, y: 47, scale: 1.29 },
  // Skeleton King
  26000069: { x: 39, y: 51, scale: 1.39 },
  // Archer Queen
  26000072: { x: 39, y: 63, scale: 1.27 },
  // Golden Knight
  26000074: { x: 37, y: 61, scale: 1.33 },
  // Monk
  26000077: { x: 51, y: 57, scale: 1.33 },
  // Skeleton Dragons
  26000080: { x: 39, y: 61, scale: 1.31 },
  // Mother Witch
  26000083: { x: 39, y: 60, scale: 1.31 },
  // Electro Spirit
  26000084: { x: 51, y: 61, scale: 1.29 },
  // Electro Giant
  26000085: { x: 44, y: 51, scale: 1.35 },
  // Phoenix
  26000087: { x: 36, y: 62, scale: 1.33 },
  // Little Prince
  26000093: { x: 44, y: 59, scale: 1.37 },
  // Goblin Demolisher
  26000095: { x: 45, y: 53, scale: 1.31 },
  // Goblin Machine
  26000096: { x: 44, y: 47, scale: 1.31 },
  // Suspicious Bush
  26000097: { x: 52, y: 41, scale: 1.35 },
  // Goblinstein
  26000099: { x: 52, y: 59, scale: 1.35 },
  // Rune Giant
  26000101: { x: 49, y: 52, scale: 1.33 },
  // Berserker
  26000102: { x: 43, y: 54, scale: 1.29 },
  // Boss Bandit
  26000103: { x: 37, y: 51, scale: 1.37 },
  // Ronin
  26000106: { x: 39, y: 49, scale: 1.37 },
  // Cannon
  27000000: { x: 56, y: 40, scale: 1.37 },
  // Goblin Hut
  27000001: { y: 66, scale: 1.35 },
  // Mortar
  27000002: { x: 44, y: 43, scale: 1.35 },
  // Inferno Tower
  27000003: { x: 44, y: 45, scale: 1.35 },
  // Bomb Tower
  27000004: { x: 51, y: 40, scale: 1.41 },
  // Barbarian Hut
  27000005: { x: 45, y: 60, scale: 1.37 },
  // Tesla
  27000006: { x: 45, y: 44, scale: 1.35 },
  // Elixir Collector
  27000007: { x: 41, y: 42, scale: 1.29 },
  // X-Bow
  27000008: { x: 62, y: 37, scale: 1.51 },
  // Tombstone
  27000009: { x: 61, y: 39, scale: 1.45 },
  // Furnace
  27000010: { x: 39, y: 42, scale: 1.31 },
  // Goblin Cage
  27000012: { x: 44, y: 42, scale: 1.37 },
  // Goblin Drill
  27000013: { x: 70, y: 35, scale: 1.65 },
  // Fireball
  28000000: { x: 37, y: 64, scale: 1.49 },
  // Arrows
  28000001: { x: 45, y: 59, scale: 1.37 },
  // Rage
  28000002: { x: 47, y: 42, scale: 1.37 },
  // Rocket
  28000003: { x: 23, y: 34, scale: 1.57 },
  // Goblin Barrel
  28000004: { x: 61, y: 36, scale: 1.41 },
  // Freeze
  28000005: { y: 42, scale: 1.33 },
  // Lightning
  28000007: { x: 44, y: 44, scale: 1.31 },
  // Zap
  28000008: { x: 49, y: 64, scale: 1.57 },
  // Poison
  28000009: { x: 49, y: 55, scale: 1.41 },
  // Graveyard
  28000010: { x: 52, y: 51, scale: 1.35 },
  // The Log
  28000011: { x: 40, y: 42, scale: 1.45 },
  // Tornado
  28000012: { x: 41, y: 60, scale: 1.37 },
  // Clone
  28000013: { x: 47, y: 58, scale: 1.41 },
  // Earthquake
  28000014: { x: 42, y: 59, scale: 1.41 },
  // Barbarian Barrel
  28000015: { x: 33, y: 48, scale: 1.35 },
  // Heal Spirit
  28000016: { x: 45, y: 45, scale: 1.27 },
  // Giant Snowball
  28000017: { x: 48, y: 48, scale: 1.33 },
  // Royal Delivery
  28000018: { x: 45, y: 41, scale: 1.35 },
  // Void
  28000023: { y: 56, scale: 1.31 },
  // Goblin Curse
  28000024: { x: 49, y: 55, scale: 1.31 },
  // Vines
  28000026: { x: 45, y: 57, scale: 1.33 }
}

export function avatarCrop(cardId: number): AvatarCrop {
  return { ...DEFAULT_AVATAR_CROP, ...AVATAR_CROP_OVERRIDES[cardId] }
}

export function hasAvatarCropOverride(cardId: number): boolean {
  return AVATAR_CROP_OVERRIDES[cardId] !== undefined
}
