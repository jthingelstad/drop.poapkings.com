import { formatSeconds } from '../../lib/format'

// One chart, one grammar, five ranked modes: bars in seconds, a per-bar
// reference tick in seconds, and a red bar where that bar cost you. The first
// spec gave each mode whatever series seemed most interesting about it and only
// Surge was readable — because Surge was the only chart whose bars and reference
// shared a unit. Rain plotted clears against fall speed, Trade printed retry
// counts under time bars, Higher / Lower hung right-or-wrong dots below them.
// Each asked a player to hold two scales at once, with no axis named and no
// legend drawn.
//
// Four parts are mandatory and live HERE, not in the modes, so no mode can ship
// without them:
//   1. a named unit, top left
//   2. a named reference, top right, with its tick drawn beside the words
//   3. a scale — max and zero on the axis, so height is a quantity
//   4. one sentence of finding beneath — what the chart proves, never what it shows
//
// `badLabel` is the fifth: red never means one thing inferred from colour, so
// each mode names its own cost ("a life lost", "it took a retry") rather than
// leaving the reader to guess it is always "over the tick" — which is false for
// Trade and Higher / Lower.

export const SIGNATURE_MAX_BARS = 30

// Shared with the share-card compositor. Both drawings read the same series and
// the same constants, or they drift apart within a release.
export const SIGNATURE_VIEW_W = 300
export const SIGNATURE_VIEW_H = 92

export interface SignatureSeries {
  // Milliseconds per answer. The component owns the seconds formatting so every
  // chart states its scale the same way.
  values: number[]
  // Milliseconds per answer for the reference tick, aligned to `values`.
  refs?: number[]
  // Per-bar: this bar cost you (what that means is `badLabel`).
  bad?: boolean[]
  // Indices carrying an event marker — Rain's three lives.
  marks?: number[]
  // Noun for the bucketed x-axis range ("Cards 1–4").
  itemNoun?: string
}

export interface SignaturePanelProps extends SignatureSeries {
  unit: string
  legend: string
  badLabel?: string
  reading: string
  max?: number
}

export interface BucketedSeries {
  values: number[]
  refs?: number[]
  bad: boolean[]
  marks: boolean[]
  // Present only when the series was folded: the range the first and last bars
  // cover, so a 120-bar deck clear still says what the x axis means.
  range?: [string, string]
}

function mean(list: number[]): number {
  if (list.length === 0) return 0
  return Math.round(list.reduce((sum, value) => sum + value, 0) / list.length)
}

// Long runs bucket. Up to 30 answers get one bar each; beyond that — a 120-card
// Survival deck clear, any deep Rain — the series folds into 30 bars, each a
// stretch's mean against that stretch's mean reference. A fatal final answer
// always keeps its own bar, because the card that ended a run is the one bar a
// player looks for. This lives here, keyed off `values.length`; no mode
// implements it.
export function bucketSeries({
  values,
  refs,
  bad = [],
  marks = [],
  itemNoun = 'Cards'
}: SignatureSeries): BucketedSeries {
  const total = values.length
  const marked = new Set(marks)
  if (total <= SIGNATURE_MAX_BARS) {
    return {
      values,
      ...(refs ? { refs } : {}),
      bad: values.map((_, i) => bad[i] === true),
      marks: values.map((_, i) => marked.has(i))
    }
  }

  // A fatal final answer is held out of the fold and keeps its own bar.
  const keepsLast = bad[total - 1] === true
  const pooled = keepsLast ? total - 1 : total
  const buckets = keepsLast ? SIGNATURE_MAX_BARS - 1 : SIGNATURE_MAX_BARS

  const outValues: number[] = []
  const outRefs: number[] = []
  const outBad: boolean[] = []
  const outMarks: boolean[] = []
  const labels: string[] = []

  for (let b = 0; b < buckets; b++) {
    const start = Math.floor((b * pooled) / buckets)
    const end = Math.floor(((b + 1) * pooled) / buckets)
    const span = values.slice(start, end)
    outValues.push(mean(span))
    if (refs) outRefs.push(mean(refs.slice(start, end)))
    outBad.push(bad.slice(start, end).some(Boolean))
    outMarks.push(span.some((_, i) => marked.has(start + i)))
    labels.push(start + 1 === end ? `${end}` : `${start + 1}–${end}`)
  }

  if (keepsLast) {
    outValues.push(values[total - 1]!)
    if (refs) outRefs.push(refs[total - 1] ?? 0)
    outBad.push(true)
    outMarks.push(marked.has(total - 1))
    labels.push(`${total}`)
  }

  return {
    values: outValues,
    ...(refs ? { refs: outRefs } : {}),
    bad: outBad,
    marks: outMarks,
    range: [`${itemNoun} ${labels[0]}`, labels[labels.length - 1]!]
  }
}

export default function SignaturePanel({
  unit,
  legend,
  badLabel,
  reading,
  max,
  values,
  refs,
  bad,
  marks,
  itemNoun
}: SignaturePanelProps) {
  const series = bucketSeries({
    values,
    ...(refs ? { refs } : {}),
    ...(bad ? { bad } : {}),
    ...(marks ? { marks } : {}),
    ...(itemNoun ? { itemNoun } : {})
  })
  const peak = Math.max(1, max ?? Math.max(0, ...series.values, ...(series.refs ?? [])))
  const n = Math.max(1, series.values.length)
  const bw = SIGNATURE_VIEW_W / n
  const y = (v: number) => SIGNATURE_VIEW_H - (Math.max(0, Math.min(v, peak)) / peak) * SIGNATURE_VIEW_H
  const hasBad = series.bad.some(Boolean)
  const hasMarks = series.marks.some(Boolean)

  return (
    <figure class="ed-sig">
      <figcaption class="ed-sig__legend">
        <span class="ed-sig__unit">{unit}</span>
        {series.refs && (
          <span class="ed-sig__ref">
            <span class="ed-sig__ref-tick" aria-hidden="true" />
            {legend}
          </span>
        )}
      </figcaption>

      <div class="ed-sig__plot">
        <div class="ed-sig__scale" aria-hidden="true">
          <span>{formatSeconds(peak)}s</span>
          <span>0</span>
        </div>
        <svg
          class="ed-sig__chart"
          viewBox={`0 0 ${SIGNATURE_VIEW_W} ${SIGNATURE_VIEW_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${unit}. ${reading}`}
        >
          {series.values.map((value, i) => {
            const barY = y(value)
            return (
              <rect
                key={i}
                class={`ed-sig__bar${series.bad[i] ? ' ed-sig__bar--bad' : ''}`}
                x={i * bw + 1.5}
                y={barY}
                width={Math.max(0, bw - 3)}
                height={SIGNATURE_VIEW_H - barY}
                rx={1.5}
              />
            )
          })}
          {series.refs?.map((ref, i) => (
            <line key={`ref-${i}`} class="ed-sig__tick" x1={i * bw + 1} x2={(i + 1) * bw - 1} y1={y(ref)} y2={y(ref)} />
          ))}
        </svg>
      </div>

      {hasMarks && (
        <div class="ed-sig__marks" aria-hidden="true">
          {series.marks.map((marked, i) => (
            <span key={i} class={`ed-sig__mark${marked ? ' ed-sig__mark--on' : ''}`} />
          ))}
        </div>
      )}

      {series.range && (
        <div class="ed-sig__range" aria-hidden="true">
          <span>{series.range[0]}</span>
          <span>{series.range[1]}</span>
        </div>
      )}

      {hasBad && badLabel && (
        <p class="ed-sig__cost">
          <span class="ed-sig__swatch" aria-hidden="true" />
          Red: {badLabel}
        </p>
      )}

      <p class="ed-sig__reading">{reading}</p>
    </figure>
  )
}
