import rawCards from '@elixir-drop/game-data/cards.json'
import type { CardsData } from '../types'

// The committed snapshot (`packages/game-data/cards.json`) is authoritative for
// the running app, but a JSON import carries no type. Assert its shape ONCE
// here so every catalog reader — choices, the keypad, signed-challenge
// resolution, the favorite-card picker, the avatar audit, the screensaver —
// shares a single typed view instead of repeating `rawCards as CardsData`.
const cardCatalog = rawCards as CardsData

export const allCards = cardCatalog.cards
export const cardCatalogVersion = cardCatalog.version
