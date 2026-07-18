import type { Card } from '../types'

export type CardRarity = Card['rarity']
export type ElixirBadgeTone = 'default' | 'wrong'

export const CARD_RARITY_LABELS: Record<CardRarity, string> = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
  champion: 'Champion'
}

export const CARD_RARITY_NAME_CLASSES: Record<CardRarity, string> = {
  common: 'cr-card-name--common',
  rare: 'cr-card-name--rare',
  epic: 'cr-card-name--epic',
  legendary: 'cr-card-name--legendary',
  champion: 'cr-card-name--champion'
}

export function classNames(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

export function cardRarityLabel(card: Pick<Card, 'rarity'>): string {
  return CARD_RARITY_LABELS[card.rarity]
}

export function cardNameToneClass(card: Pick<Card, 'rarity'>): string {
  return CARD_RARITY_NAME_CLASSES[card.rarity]
}

export function cardRarityModifier(card: Pick<Card, 'rarity'>, block: string): string {
  return `${block}--${card.rarity}`
}
