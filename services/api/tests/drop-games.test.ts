import { expect, it, vi } from "vitest";
import {
  gameCard,
  gamePlayer,
  gameOutboxItem,
  playedGame,
} from "../src/drop-game.js";
import { deliverDropGames } from "../src/refresh-worker.js";
import type { RunItem } from "../src/repository.js";
import type { PlayerProfile } from "../src/types.js";

const player = {
  accountId: "00000000-0000-4000-8000-000000000001",
  playerTag: "#PYY",
};
const profile = {
  elixir: { ...player, verified: true },
  elixirAccountId: player.accountId,
  playerTag: player.playerTag,
} as PlayerProfile;
const game = {
  gameId: "00000000-0000-4000-8000-000000000002",
  mode: "exact-ten" as const,
  startedAt: "2026-11-18T00:00:00Z",
  score: 10,
  answers: 1,
  cards: [gameCard(26000000, "solution")],
};
it("requires matching verified link and account; a scored Surge recovery names its canonical card", () => {
  expect(gamePlayer(profile)).toEqual(player);
  expect(gamePlayer({ ...profile, playerTag: "#QQQ" })).toBeUndefined();
  expect(
    gamePlayer({ ...profile, elixirAccountId: undefined }),
  ).toBeUndefined();
  expect(
    gamePlayer({ ...profile, elixir: { ...profile.elixir!, verified: false } }),
  ).toBeUndefined();
  const run = {
    runId: game.gameId,
    startedAt: game.startedAt,
    mode: "surge",
    challenge: { mode: "surge", cardIds: [26000000] },
  } as RunItem;
  expect(
    playedGame(run, { answers: [{ cardId: 26000000, guesses: [2, 3] }] }, 4200)
      .cards,
  ).toEqual([{ id: 26000000, name: "Knight", cost: 3, reason: "recovered" }]);
});
it("keeps a failed send pending and redelivers the same game without leaking its storage keys", async () => {
  const item = gameOutboxItem("private-sub", player, game, game.startedAt);
  const repo = {
    pendingDropGames: vi.fn().mockResolvedValue([item]),
    acknowledgeDropGame: vi.fn(),
  };
  await expect(
    deliverDropGames(repo, async () => {
      throw Error("unavailable");
    }),
  ).rejects.toThrow();
  expect(repo.acknowledgeDropGame).not.toHaveBeenCalled();
  const send = vi.fn().mockResolvedValue({});
  await deliverDropGames(repo, send);
  expect(JSON.parse(send.mock.calls[0]![0])).toEqual({
    version: 1,
    type: "drop.game.completed",
    ...player,
    ...game,
    completedAt: game.startedAt,
  });
  expect(repo.acknowledgeDropGame).toHaveBeenCalledWith(item.pk, item.sk);
});
