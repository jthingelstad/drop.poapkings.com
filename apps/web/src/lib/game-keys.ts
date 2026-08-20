import { signal } from '@preact/signals'

// One advertised desktop layout for every elixir-cost answer surface. The
// number row remains an alias, but the home row is the fast path: the left hand
// owns 1–5 and the right hand owns 6–9.
//
// Everything binds by PHYSICAL key (`event.code`), never by character. On AZERTY
// the home row is *qsdfg* and on QWERTZ the key right of L is not `;` at all, so
// a character binding tests perfectly in US and silently breaks elsewhere.
// `code` is position, and position is what "resting your fingers there" means.
export const HOME_ROW_CODE_BY_COST = {
  1: 'KeyA',
  2: 'KeyS',
  3: 'KeyD',
  4: 'KeyF',
  5: 'KeyG',
  6: 'KeyJ',
  7: 'KeyK',
  8: 'KeyL',
  9: 'Semicolon'
} as const

// The US legend, and the fallback everywhere the browser will not tell us what
// is actually printed on the key.
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

const COST_BY_CODE: Record<string, number> = Object.fromEntries(
  Object.entries(HOME_ROW_CODE_BY_COST).map(([cost, code]) => [code, Number(cost)])
)

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

// ── What is printed on the key ───────────────────────────────────────────────
// The binding is positional, so the US letter is a guess about the legend under
// the player's finger — right for QWERTY, wrong for AZERTY and QWERTZ. Chromium
// exposes `navigator.keyboard.getLayoutMap()`, which answers it exactly; every
// other browser is left with the US letters. A WRONG letter is worse than a
// generic one, so we substitute only when the browser actually resolves the
// layout, never on a guess from locale or language.
const resolvedLegend = signal<Record<number, string> | null>(null)

export function keyLegendForCost(cost: number): string | null {
  const resolved = resolvedLegend.value?.[cost]
  if (resolved) return resolved
  return shortcutForCost(cost)
}

export function keyLegendRow(): string[] {
  return Object.keys(HOME_ROW_KEY_BY_COST)
    .map(Number)
    .sort((a, b) => a - b)
    .map((cost) => keyLegendForCost(cost) ?? '')
}

interface KeyboardLayoutApi {
  getLayoutMap?: () => Promise<Map<string, string>>
}

// Called once at boot. Failure is silent and total: the caps keep the US letters
// they already carry.
export async function resolveKeyLegend(
  keyboard: KeyboardLayoutApi | undefined = (navigator as Navigator & { keyboard?: KeyboardLayoutApi }).keyboard
): Promise<void> {
  if (typeof keyboard?.getLayoutMap !== 'function') return
  try {
    const map = await keyboard.getLayoutMap()
    const legend: Record<number, string> = {}
    for (const [cost, code] of Object.entries(HOME_ROW_CODE_BY_COST)) {
      const printed = map.get(code)?.trim()
      // An empty or multi-character legend ("Dead", "AltGr") is not a keycap
      // label; keep the US letter. `u` so one astral code point still counts.
      if (printed && /^.$/u.test(printed)) legend[Number(cost)] = printed.toLocaleUpperCase()
    }
    if (Object.keys(legend).length > 0) resolvedLegend.value = legend
  } catch {
    // Permission-gated or unimplemented. The US fallback already renders.
  }
}

export function resetKeyLegendForTests(): void {
  resolvedLegend.value = null
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
