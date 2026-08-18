import type { SignatureBar } from '../components/summary/SignaturePanel'

// Pure builders for the summary signature panels. Each mode hands over arrays it
// already has in hand at completion; the chart math and the one-sentence
// read-back live here so the panel component stays a dumb renderer and the mode
// components stay thin. No card lookups here — correctness is decided in the
// mode, where the cards are.

export interface Signature {
  bars: SignatureBar[]
  line?: number[]
  caption: string
  max?: number
}

// Surge: a bar per card (this run's time), the previous best's pace drawn across,
// bars red where this run lost to it.
export function surgeSignature(perCardMs: number[], bestPerCardMs?: number[]): Signature {
  const bars: SignatureBar[] = perCardMs.map((ms, i) => {
    const best = bestPerCardMs?.[i]
    return { value: ms, tone: best !== undefined && ms > best ? 'bad' : 'base' }
  })
  const lost = bars.filter((b) => b.tone === 'bad').length
  const caption = bestPerCardMs?.length
    ? lost === 0
      ? 'Faster than your best run on every card.'
      : `Slower than your best run on ${lost} of ${bars.length} cards.`
    : 'Your pace, card by card — the line to beat next run.'
  return { bars, ...(bestPerCardMs?.length ? { line: bestPerCardMs } : {}), caption }
}

// Survival: response time per card with the shrinking window drawn above; they
// converge, and the run ends where they meet.
export function survivalSignature(perCardMs: number[], windowMs: number[]): Signature {
  const bars: SignatureBar[] = perCardMs.map((ms, i) => ({
    value: ms,
    tone: windowMs[i] !== undefined && ms > windowMs[i] * 0.85 ? 'bad' : 'base'
  }))
  return {
    bars,
    line: windowMs,
    caption: 'Your reads against the shrinking window — the gap closes as the deck runs down.'
  }
}

// Trade: ten rounds, the time on each, with the retries marked beneath.
export function tradeSignature(perRoundMs: number[], retries: number[]): Signature {
  const bars: SignatureBar[] = perRoundMs.map((ms, i) => ({
    value: ms,
    tone: retries[i] > 0 ? 'bad' : 'base',
    dot: retries[i] > 0 ? 'bad' : 'ok'
  }))
  const clean = retries.filter((r) => r === 0).length
  return { bars, caption: `${clean} of ${bars.length} exchanges read first try.` }
}

// Higher / Lower: read speed per pair, a right/wrong dot beneath each.
export function duelSignature(perPairMs: number[], correct: boolean[]): Signature {
  const bars: SignatureBar[] = perPairMs.map((ms, i) => ({
    value: ms,
    tone: correct[i] ? 'base' : 'bad',
    dot: correct[i] ? 'ok' : 'bad'
  }))
  const right = correct.filter(Boolean).length
  return { bars, caption: `${right} of ${bars.length} reads correct — the shape is your speed under the clock.` }
}

// Rain: clears per ten seconds as bars, with the rising fall speed over them in
// gold — they cross where the field beat you.
export function rainSignature(clearsPer10s: number[], fallSpeed: number[]): Signature {
  const bars: SignatureBar[] = clearsPer10s.map((n) => ({ value: n, tone: 'base' }))
  return { bars, line: fallSpeed, caption: 'Clears every ten seconds against the rising fall speed.' }
}

// Ledger: accuracy by sequence length. Each bar is one length's hit rate, so the
// shape shows where the running count starts to break as sequences get longer.
export function ledgerSignature(lengths: number[], correct: boolean[]): Signature {
  const byLength = new Map<number, { correct: number; total: number }>()
  lengths.forEach((len, i) => {
    const bucket = byLength.get(len) ?? { correct: 0, total: 0 }
    bucket.total += 1
    if (correct[i]) bucket.correct += 1
    byLength.set(len, bucket)
  })
  const sorted = [...byLength.entries()].sort((a, b) => a[0] - b[0])
  const bars: SignatureBar[] = sorted.map(([, b]) => {
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
export function costRecallSignature(returns: Array<{ ms: number; correct: boolean }>): Signature {
  const bars: SignatureBar[] = returns.map((r) => ({
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
