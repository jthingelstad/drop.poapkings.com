import type { SignaturePanelProps } from '../components/summary/SignaturePanel'
import type { DrillBar } from '../components/summary/DrillPanel'
import { formatSeconds } from './format'

// Pure builders for the summary signature panels. Each mode hands over arrays it
// already has in hand at completion; the read-back sentence lives here so the
// panel stays a renderer and the modes stay thin. No card lookups here —
// correctness is decided in the mode, where the cards are.
//
// Every ranked mode speaks the same grammar: bars in seconds, a per-bar
// reference tick in seconds, a red bar where that bar cost you, and the cost
// named rather than inferred from the colour. The axis, the legend, the colour
// rule, the bucketing and the layout all live in the component.

export type Signature = Omit<SignaturePanelProps, 'max'> & { max?: number }

// The two drills keep their own shape — see DrillPanel for why.
export interface DrillSignature {
  bars: DrillBar[]
  caption: string
  max?: number
}

function average(list: number[]): number {
  if (list.length === 0) return 0
  return Math.round(list.reduce((sum, value) => sum + value, 0) / list.length)
}

function seconds(ms: number): string {
  return `${formatSeconds(ms)}s`
}

// ── Surge ───────────────────────────────────────────────────────────────────
// Seconds per card against the same card in your best run.
export function surgeSignature(perCardMs: number[], bestPerCardMs?: number[]): Signature {
  const hasBest = Boolean(bestPerCardMs?.length)
  const bad = perCardMs.map((ms, i) => {
    const best = bestPerCardMs?.[i]
    return best !== undefined && ms > best
  })
  const lost = bad.filter(Boolean).length
  const reading = hasBest
    ? lost === 0
      ? 'You beat your best run on every card.'
      : `Your best run was quicker on ${lost} of ${perCardMs.length} cards.`
    : `You averaged ${seconds(average(perCardMs))} a card — the pace your next run has to beat.`
  return {
    unit: 'Seconds per card',
    legend: 'The same card in your best run',
    badLabel: 'slower than your best there',
    values: perCardMs,
    ...(hasBest ? { refs: bestPerCardMs!, bad } : {}),
    reading
  }
}

// ── Rain ────────────────────────────────────────────────────────────────────
// Seconds to answer against how long that card had left to fall. A red bar is a
// life lost, and the three lives are marked as events.
export function rainSignature(answerMs: number[], fallLeftMs: number[], lost: boolean[]): Signature {
  const lives = lost.reduce<number[]>((acc, isLost, i) => (isLost ? [...acc, i] : acc), [])
  const reading =
    lives.length > 0
      ? `You answered in ${seconds(average(answerMs))} against ${seconds(average(fallLeftMs))} of fall time, and ${lives.length === 1 ? 'one card' : `${lives.length} cards`} closed that gap.`
      : `You answered in ${seconds(average(answerMs))} against ${seconds(average(fallLeftMs))} of fall time, and nothing reached the line.`
  return {
    unit: 'Seconds to answer',
    legend: 'How long that card had left to fall',
    badLabel: 'a life lost',
    values: answerMs,
    refs: fallLeftMs,
    bad: lost,
    marks: lives,
    reading
  }
}

// ── Survival ────────────────────────────────────────────────────────────────
// Seconds to answer against the window at that streak. One red bar at most: the
// card that ended it.
export function survivalSignature(perCardMs: number[], windowMs: number[], fatalIndex: number): Signature {
  const bad = perCardMs.map((_, i) => i === fatalIndex)
  const lastWindow = windowMs[windowMs.length - 1]
  const reading =
    fatalIndex >= 0
      ? `You answered in ${seconds(average(perCardMs))} on average, against a window down to ${seconds(lastWindow ?? 0)} by the card that ended it.`
      : `You cleared the deck in ${seconds(average(perCardMs))} a card, against a window down to ${seconds(lastWindow ?? 0)}.`
  return {
    unit: 'Seconds to answer',
    legend: 'Your window at that streak',
    badLabel: 'the card that ended it',
    values: perCardMs,
    refs: windowMs,
    bad,
    reading
  }
}

// ── Trade ───────────────────────────────────────────────────────────────────
// Seconds per exchange against this run's average round. A red bar took a retry
// — never "over the tick", which is exactly the inference this grammar refuses.
export function tradeSignature(perRoundMs: number[], retries: number[]): Signature {
  const mean = average(perRoundMs)
  const bad = retries.map((count) => count > 0)
  const clean = retries.filter((count) => count === 0).length
  return {
    unit: 'Seconds per exchange',
    legend: 'Your average round this run',
    badLabel: 'it took a retry',
    values: perRoundMs,
    refs: perRoundMs.map(() => mean),
    bad,
    itemNoun: 'Exchanges',
    reading: `${clean} of ${perRoundMs.length} exchanges read first try, at ${seconds(mean)} a round.`
  }
}

// ── Higher / Lower ──────────────────────────────────────────────────────────
// Seconds per read against this run's average read. A red bar is a wrong read.
export function duelSignature(perPairMs: number[], correct: boolean[]): Signature {
  const mean = average(perPairMs)
  const right = correct.filter(Boolean).length
  return {
    unit: 'Seconds per read',
    legend: 'Your average read this run',
    badLabel: 'a wrong read',
    values: perPairMs,
    refs: perPairMs.map(() => mean),
    bad: correct.map((ok) => !ok),
    itemNoun: 'Reads',
    reading: `${right} of ${perPairMs.length} reads correct, at ${seconds(mean)} each.`
  }
}

// ── The two drills, exempt by design ────────────────────────────────────────

// Ledger: accuracy by sequence length. Each bar is one length's hit rate, so the
// shape shows where the running count starts to break as sequences get longer.
export function ledgerSignature(lengths: number[], correct: boolean[]): DrillSignature {
  const byLength = new Map<number, { correct: number; total: number }>()
  lengths.forEach((len, i) => {
    const bucket = byLength.get(len) ?? { correct: 0, total: 0 }
    bucket.total += 1
    if (correct[i]) bucket.correct += 1
    byLength.set(len, bucket)
  })
  const sorted = [...byLength.entries()].sort((a, b) => a[0] - b[0])
  const bars: DrillBar[] = sorted.map(([, b]) => {
    const pct = Math.round((b.correct / b.total) * 100)
    return { value: pct, tone: pct < 70 ? 'bad' : 'base' }
  })
  const worst = sorted.reduce<{ len: number; pct: number } | null>((acc, [len, b]) => {
    const pct = b.correct / b.total
    return acc === null || pct < acc.pct ? { len, pct } : acc
  }, null)
  const caption =
    bars.length <= 1
      ? 'Your read on the running count this session.'
      : bars.every((bar) => bar.value >= 90)
        ? 'The count holds across every sequence length.'
        : `The running count breaks around ${worst!.len}-card sequences.`
  return { bars, caption, max: 100 }
}

// Cost Recall: the cards that came back after a gap, and whether they held. One
// bar per returned card (its read time), the dot marking held vs missed again.
export function costRecallSignature(returns: Array<{ ms: number; correct: boolean }>): DrillSignature {
  const bars: DrillBar[] = returns.map((r) => ({
    value: r.ms,
    tone: r.correct ? 'base' : 'bad',
    dot: r.correct ? 'ok' : 'bad'
  }))
  const held = returns.filter((r) => r.correct).length
  return {
    bars,
    caption: `Held ${held} of ${returns.length} ${returns.length === 1 ? 'card' : 'cards'} on their return.`
  }
}
