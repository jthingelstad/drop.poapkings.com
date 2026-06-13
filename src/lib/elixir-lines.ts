// Elixir host line table — static, no LLM at runtime.
// Voice: dry, a little cocky, never mean.

const TABLE: Record<string, string[]> = {
  correct_fast: [
    'Too easy. Next.',
    'You felt that one.',
    'Called it.',
    'Yeah you knew that.',
    'Solid.',
  ],
  correct_streak: [
    '{n} in a row. The clan would notice.',
    '{n} straight. Don\'t get comfortable.',
    'Okay, {n} in a row. I\'m paying attention.',
    '{n} and counting. Scary.',
  ],
  wrong_close: [
    'Off by one. That one pip loses games.',
    'Close. Wrong.',
    'One off. One off costs you trades.',
    '±1 is a game-losing error at high ladder.',
    'Almost. Not good enough though.',
  ],
  wrong_far: [
    'Not close. Drill this band.',
    'That\'s a big miss.',
    'Nope. Worth grinding.',
    'You\'re guessing. Stop guessing.',
    'Wide. Learn the cost, own the card.',
  ],
  surge_done: [
    '{time}s. {insight}',
    '{time}s — {insight}',
  ],
  record: [
    'New best: {time}s. People who read elixir like this win wars →',
    'PB: {time}s. That\'s clan-ready awareness →',
  ],
  recruit: [
    'You\'re reading elixir like a clan member. We have room for that →',
    'That\'s the kind of game sense POAP KINGS runs on →',
  ],
  idle: [
    'Tap a card. Let\'s go.',
    'Pick one.',
    'Ready when you are.',
    'Waiting on you.',
  ],
}

function pick(lines: string[]): string {
  return lines[Math.floor(Math.random() * lines.length)]
}

export function pickLine(
  event: keyof typeof TABLE,
  vars: Record<string, string | number> = {},
): string {
  const lines = TABLE[event]
  if (!lines) return ''

  let line = pick(lines)
  for (const [k, v] of Object.entries(vars)) {
    line = line.replaceAll(`{${k}}`, String(v))
  }
  return line
}
