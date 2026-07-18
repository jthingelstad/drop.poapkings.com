import type { Card } from '../types'

export function targetIds(cards: Pick<Card, 'id' | 'elixir'>[], targetElixir: number): Set<number> {
  return new Set(cards.filter((card) => card.elixir === targetElixir).map((card) => card.id))
}

export function remainingTargetIds(
  cards: Pick<Card, 'id' | 'elixir'>[],
  targetElixir: number,
  selectedIds: ReadonlySet<number>
): number[] {
  return cards.filter((card) => card.elixir === targetElixir && !selectedIds.has(card.id)).map((card) => card.id)
}

export function isSweepComplete(
  cards: Pick<Card, 'id' | 'elixir'>[],
  targetElixir: number,
  selectedIds: ReadonlySet<number>
): boolean {
  return remainingTargetIds(cards, targetElixir, selectedIds).length === 0
}

export function countTargetCards(cards: Pick<Card, 'elixir'>[], targetElixir: number): number {
  return cards.filter((card) => card.elixir === targetElixir).length
}
