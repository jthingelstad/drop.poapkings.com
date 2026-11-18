import { randomInt, randomUUID } from "node:crypto";
import { exactTenHand } from "@elixir-drop/contracts/challenge-generation";
import catalog from "@elixir-drop/game-data/cards.json";
import { gameCard, gamePlayer } from "../drop-game.js";
import { HttpError } from "../errors.js";
import { json } from "../http.js";
import { signToken, verifyToken } from "../signing.js";
import {
  bodyOf,
  clientIpHash,
  sessionFor,
  type RouteContext,
} from "./context.js";

export async function startExactTen({
  request,
  config,
  repository,
}: RouteContext) {
  const sess = sessionFor(request, config.sessionSecret, true);
  await repository.useRateLimit("run-start", clientIpHash(request), 300, 3600);
  const cardIds = exactTenHand(catalog.cards, randomInt).map((c) => c.id);
  const iat = Math.floor(Date.now() / 1000);
  const handToken = signToken(
    {
      type: "exact-ten",
      owner: sess.sub,
      gameId: randomUUID(),
      cardIds,
      iat,
      exp: iat + 86400,
    },
    config.sessionSecret,
  );
  return json(201, { cardIds, handToken });
}

export async function completeExactTen({
  request,
  config,
  repository,
}: RouteContext) {
  const sess = sessionFor(request, config.sessionSecret, true);
  await repository.useRateLimit(
    "run-complete",
    clientIpHash(request),
    300,
    3600,
  );
  const { handToken, selected } = bodyOf(request);
  let hand;
  try {
    hand = verifyToken(String(handToken), "exact-ten", config.sessionSecret);
  } catch {
    throw new HttpError(400, "This signed hand has expired or is invalid.");
  }
  if (hand.owner !== sess.sub)
    throw new HttpError(403, "This hand belongs to another player.");
  if (
    !Array.isArray(selected) ||
    !selected.length ||
    selected.length > 5 ||
    new Set(selected).size !== selected.length ||
    !selected.every((id) => hand.cardIds.includes(id))
  )
    throw new HttpError(400, "Choose distinct cards from this hand.");
  const cards = selected.map((id) => gameCard(id, "solution"));
  if (cards.reduce((total, card) => total + card.cost, 0) !== 10)
    throw new HttpError(400, "The selected cards must add up to ten.");
  const profile = await repository.getProfile(sess.sub);
  if (!profile) throw new HttpError(401, "Sign in again to record this hand.");
  const completedAt = await repository.recordExactTen(
    sess.sub,
    gamePlayer(profile),
    {
      gameId: hand.gameId,
      mode: "exact-ten",
      startedAt: new Date(hand.iat * 1000).toISOString(),
      score: 10,
      answers: 1,
      cards,
    },
  );
  return json(200, { completedAt });
}
