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

// The two practice drills (Cost Recall, Ledger) do not yet get a signature
// panel: they are endless, unscored, share-less sandboxes, and Cost Recall's
// per-answer correctness is not carried on its server-shaped transcript. Their
// summaries keep the existing coaching read-back and the "Work on these" list.
