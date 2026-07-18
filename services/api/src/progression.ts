export interface LevelProgress {
  level: number;
  levelStartGames: number;
  nextLevelGames: number;
}

export function gamesRequiredForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1)
    throw new Error("Level must be a positive integer");
  return (5 * level * (level - 1)) / 2;
}

export function levelForGames(totalGames: number): LevelProgress {
  const games = Math.max(0, Math.floor(totalGames));
  let level = Math.floor((1 + Math.sqrt(1 + (8 * games) / 5)) / 2);
  while (gamesRequiredForLevel(level + 1) <= games) level += 1;
  while (level > 1 && gamesRequiredForLevel(level) > games) level -= 1;
  return {
    level,
    levelStartGames: gamesRequiredForLevel(level),
    nextLevelGames: gamesRequiredForLevel(level + 1),
  };
}
