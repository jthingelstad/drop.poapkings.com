// Session insight layer — what makes Elixir Drop a coach, not a quiz (SPEC §5).
// Pure functions over a session's answers. Shared by Practice and Surge summaries.

import type { Card } from '../types'

// One graded answer in a session. `ms` present only in timed modes (Surge),
// where it is the total time spent on the card (incl. retries).
export interface Answer {
  card: Card
  guess: number // the player's first guess for this card
  correct: boolean // whether the first guess was correct
  ms?: number
}

export interface BandStat {
  label: string
  correct: number
  total: number
}

export interface Insights {
  total: number
  correct: number
  accuracyPct: number
  bands: BandStat[]
  weakest: Card[] // unique missed cards, most-missed first
  biasLine?: string // directional bias, e.g. "tends to overestimate spells by ~1"
  hasTiming: boolean
  slowestBandLabel?: string
  slowestCards?: Card[]
}

// Five cost bands, matching the redesign's accuracy-by-cost bars.
const BANDS: { label: string; test: (e: number) => boolean }[] = [
  { label: '1–2', test: (e) => e <= 2 },
  { label: '3', test: (e) => e === 3 },
  { label: '4', test: (e) => e === 4 },
  { label: '5', test: (e) => e === 5 },
  { label: '6+', test: (e) => e >= 6 }
]

function bandLabel(elixir: number): string {
  return (BANDS.find((b) => b.test(elixir)) ?? BANDS[BANDS.length - 1]).label
}

function typePlural(type: Card['type']): string {
  if (type === 'troop') return 'troops'
  if (type === 'spell') return 'spells'
  return 'buildings'
}

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0
}

export function computeInsights(answers: Answer[]): Insights {
  const total = answers.length
  const correct = answers.filter((a) => a.correct).length
  const accuracyPct = total > 0 ? Math.round((correct / total) * 100) : 0

  // Accuracy by cost band (1–2 / 3–4 / 5+)
  const bands: BandStat[] = BANDS.map((b) => {
    const inBand = answers.filter((a) => b.test(a.card.elixir))
    return { label: b.label, correct: inBand.filter((a) => a.correct).length, total: inBand.length }
  })

  // Weakest cards: unique cards missed, most misses first
  const missByCard = new Map<number, { card: Card; misses: number }>()
  for (const a of answers) {
    if (a.correct) continue
    const e = missByCard.get(a.card.id) ?? { card: a.card, misses: 0 }
    e.misses++
    missByCard.set(a.card.id, e)
  }
  const weakest = [...missByCard.values()].sort((x, y) => y.misses - x.misses).map((e) => e.card)

  // Directional bias from wrong answers (signed error = guess − actual)
  const wrong = answers.filter((a) => !a.correct)
  let biasLine: string | undefined
  if (wrong.length >= 3) {
    const byType = new Map<Card['type'], number[]>()
    for (const a of wrong) {
      const arr = byType.get(a.card.type) ?? []
      arr.push(a.guess - a.card.elixir)
      byType.set(a.card.type, arr)
    }
    let strongest: { type: Card['type']; m: number } | null = null
    for (const [type, errs] of byType) {
      if (errs.length < 2) continue
      const m = mean(errs)
      if (!strongest || Math.abs(m) > Math.abs(strongest.m)) strongest = { type, m }
    }
    const overallMean = mean(wrong.map((a) => a.guess - a.card.elixir))
    if (strongest && Math.abs(strongest.m) >= 0.75) {
      const dir = strongest.m > 0 ? 'overestimate' : 'underestimate'
      const mag = Math.max(1, Math.round(Math.abs(strongest.m)))
      biasLine = `you ${dir} ${typePlural(strongest.type)} by ~${mag}`
    } else if (Math.abs(overallMean) >= 0.5) {
      const dir = overallMean > 0 ? 'overestimate' : 'underestimate'
      const mag = Math.max(1, Math.round(Math.abs(overallMean)))
      biasLine = `you ${dir} by ~${mag} elixir`
    }
  }

  // Timing (Surge): slowest band + slowest cards from split times
  const timed = answers.filter((a) => a.ms !== undefined)
  const hasTiming = timed.length > 0
  let slowestBandLabel: string | undefined
  let slowestCards: Card[] | undefined
  if (hasTiming) {
    const bandMs = new Map<string, number[]>()
    for (const a of timed) {
      const lbl = bandLabel(a.card.elixir)
      const arr = bandMs.get(lbl) ?? []
      arr.push(a.ms as number)
      bandMs.set(lbl, arr)
    }
    let slowest: { label: string; avg: number } | null = null
    for (const [label, arr] of bandMs) {
      const avg = mean(arr)
      if (!slowest || avg > slowest.avg) slowest = { label, avg }
    }
    slowestBandLabel = slowest?.label
    slowestCards = [...timed]
      .sort((a, b) => (b.ms as number) - (a.ms as number))
      .slice(0, 3)
      .map((a) => a.card)
  }

  return { total, correct, accuracyPct, bands, weakest, biasLine, hasTiming, slowestBandLabel, slowestCards }
}

// The single, most-actionable insight phrase for Elixir to speak on the summary.
export function insightPhrase(ins: Insights): string {
  const weakBand = [...ins.bands]
    .filter((b) => b.total >= 2)
    .sort((a, b) => a.correct / a.total - b.correct / b.total)[0]

  if (weakBand && weakBand.correct / weakBand.total < 0.6) {
    return ins.hasTiming
      ? `you bleed accuracy on ${weakBand.label} cost cards`
      : `${weakBand.label} cost cards are your weak spot`
  }
  if (ins.hasTiming && ins.slowestBandLabel) return `you bleed time on ${ins.slowestBandLabel} cost cards`
  if (ins.biasLine) return ins.biasLine
  if (ins.accuracyPct >= 90) return 'clean read across the board'
  return 'solid — now drill the misses'
}
