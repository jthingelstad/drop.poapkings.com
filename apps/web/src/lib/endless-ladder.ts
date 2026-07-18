import type { Card } from '../types'

export function canInsertAt(row: Pick<Card, 'elixir'>[], card: Pick<Card, 'elixir'>, slotIndex: number): boolean {
  if (slotIndex < 0 || slotIndex > row.length) return false

  const left = row[slotIndex - 1]
  const right = row[slotIndex]

  if (left && left.elixir > card.elixir) return false
  if (right && card.elixir > right.elixir) return false
  return true
}

export function validInsertSlots(row: Pick<Card, 'elixir'>[], card: Pick<Card, 'elixir'>): number[] {
  const slots: number[] = []
  for (let slot = 0; slot <= row.length; slot += 1) {
    if (canInsertAt(row, card, slot)) slots.push(slot)
  }
  return slots
}

export function insertAtSlot<T>(row: T[], item: T, slotIndex: number): T[] {
  if (slotIndex < 0 || slotIndex > row.length) return row
  return [...row.slice(0, slotIndex), item, ...row.slice(slotIndex)]
}
