// One advertised desktop layout for every elixir-cost answer surface. The
// number row remains an alias, but the home row is the fast path: the left hand
// owns 1–5 and the right hand owns 6–9.
export const HOME_ROW_KEY_BY_COST = {
  1: 'A',
  2: 'S',
  3: 'D',
  4: 'F',
  5: 'G',
  6: 'J',
  7: 'K',
  8: 'L',
  9: ';'
} as const

const COST_BY_CODE: Record<string, number> = {
  KeyA: 1,
  KeyS: 2,
  KeyD: 3,
  KeyF: 4,
  KeyG: 5,
  KeyJ: 6,
  KeyK: 7,
  KeyL: 8,
  Semicolon: 9
}

const COST_BY_KEY: Record<string, number> = {
  a: 1,
  s: 2,
  d: 3,
  f: 4,
  g: 5,
  j: 6,
  k: 7,
  l: 8,
  ';': 9
}

export function costForGameKey(event: Pick<KeyboardEvent, 'code' | 'key'>): number | null {
  const homeRow = COST_BY_CODE[event.code] ?? COST_BY_KEY[event.key.toLocaleLowerCase()]
  if (homeRow !== undefined) return homeRow
  return /^[1-9]$/.test(event.key) ? Number(event.key) : null
}

export function shortcutForCost(cost: number): string | null {
  return HOME_ROW_KEY_BY_COST[cost as keyof typeof HOME_ROW_KEY_BY_COST] ?? null
}

export function isSpaceKey(event: Pick<KeyboardEvent, 'code' | 'key'>): boolean {
  return event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar'
}

export function isInteractiveKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(
    target.closest('button, a[href], input, select, textarea, [contenteditable="true"], [role="button"], [role="link"]')
  )
}
