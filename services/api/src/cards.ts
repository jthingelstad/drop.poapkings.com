import rawCards from "@elixir-drop/game-data/cards.json";

interface CardData {
  cards: Array<{ id: number; name: string }>;
}

export interface FavoriteCard {
  id: number;
  name: string;
}

const cards = (rawCards as CardData).cards.map(({ id, name }) => ({
  id,
  name,
}));
const cardsById = new Map(cards.map((card) => [card.id, card]));

export function favoriteCard(value: unknown): FavoriteCard | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return;
  return cardsById.get(value);
}
