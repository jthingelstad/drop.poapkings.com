import { favoriteCard } from "./cards.js";
import { cardResultsFromTranscript } from "./learning.js";
import type { RunItem } from "./repository.js";
import { cardElixir } from "./scoring.js";
import type { GameMode, PlayerProfile, RunTranscript } from "./types.js";

export interface GamePlayer {
  accountId: string;
  playerTag: string;
}
export function gamePlayer(
  profile: PlayerProfile | undefined,
): GamePlayer | undefined {
  const link = profile?.elixir;
  if (
    link?.verified &&
    link.playerTag &&
    link.playerTag === profile?.playerTag &&
    link.accountId === profile.elixirAccountId
  )
    return { accountId: link.accountId, playerTag: link.playerTag };
}

type CardReason = "first-read" | "recovered" | "played" | "solution";
export function gameCard(id: number, reason: CardReason) {
  const card = favoriteCard(id);
  const cost = cardElixir(id);
  if (!card || cost === undefined) throw new Error("Unknown game card");
  return { id, name: card.name, cost, reason };
}

export interface GameResult {
  gameId: string;
  mode: GameMode | "exact-ten";
  startedAt: string;
  score: number;
  answers: number;
  cards: ReturnType<typeof gameCard>[];
}
export type DropGame = GameResult &
  GamePlayer & { version: 1; type: "drop.game.completed"; completedAt: string };

export function playedGame(
  run: RunItem,
  transcript: RunTranscript,
  score: number,
): GameResult {
  const answers = Array.isArray(transcript.answers) ? transcript.answers : [];
  const results = cardResultsFromTranscript(run.challenge, transcript);
  const firstRead = results.find((r) => r.correct && !r.assisted);
  const recovered =
    run.mode === "surge" ? results.find((r) => !r.correct) : undefined;
  let cards: GameResult["cards"] = [];
  if (recovered) {
    cards = [gameCard(recovered.cardId, "recovered")];
  } else if (firstRead) {
    cards = [gameCard(firstRead.cardId, "first-read")];
  } else if (run.challenge.mode === "trade" && answers.length) {
    const round = run.challenge.rounds[answers.length - 1]!;
    cards = [...round.redIds, ...round.blueIds]
      .slice(0, 3)
      .map((id) => gameCard(id, "played"));
  } else if (run.challenge.mode === "higher-lower" && answers.length) {
    cards = run.challenge.pairs[answers.length - 1]!.map((id) =>
      gameCard(id, "played"),
    );
  } else if (answers[0]?.cardId && favoriteCard(answers[0].cardId)) {
    cards = [gameCard(answers[0].cardId, "played")];
  }
  return {
    gameId: run.runId,
    mode: run.mode,
    startedAt: run.startedAt,
    score,
    answers: answers.length,
    cards,
  };
}
export function gameOutboxItem(
  owner: string,
  player: GamePlayer,
  game: GameResult,
  completedAt: string,
) {
  const event: DropGame = {
    version: 1,
    type: "drop.game.completed",
    ...player,
    ...game,
    completedAt,
  };
  // The player's own partition participates in ordinary account deletion.
  return {
    pk: `PLAYER#${owner}`,
    sk: `GAMEOUT#${game.gameId}`,
    GSI1PK: "GAMEOUT",
    GSI1SK: `${completedAt}#${game.gameId}`,
    event,
  };
}
