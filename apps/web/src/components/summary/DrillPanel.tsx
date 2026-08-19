// The two drills are exempt from the ranked chart grammar and this is where
// that exemption lives. Cost Recall's review ledger answers "what stuck" and
// Ledger's accuracy-by-sequence-length answers "where does the count break" —
// neither is a time chart, and a drill is not racing anything, so seconds are
// the wrong unit. Forcing them into `SignaturePanel` would make both of them
// worse to make the file count smaller.
//
// This is the renderer the summaries shipped with, unchanged: a bar series with
// optional per-bar dots, read back in one sentence.

export interface DrillBar {
  value: number
  // base = neutral, bad = this bar lost (slower/wrong), gold = a highlight.
  tone?: 'base' | 'bad' | 'gold'
  // A small marker beneath the bar (right/wrong, held/missed).
  dot?: 'ok' | 'bad'
}

const VIEW_W = 300
const VIEW_H = 92

export default function DrillPanel({ bars, caption, max }: { bars: DrillBar[]; caption: string; max?: number }) {
  const values = bars.map((b) => b.value)
  const peak = Math.max(1, max ?? Math.max(0, ...values))
  const n = Math.max(1, bars.length)
  const bw = VIEW_W / n
  const hasDots = bars.some((b) => b.dot)
  const y = (v: number) => VIEW_H - (Math.max(0, v) / peak) * VIEW_H

  return (
    <div class="ed-sig ed-sig--drill">
      <svg
        class="ed-sig__chart"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={caption}
      >
        {bars.map((bar, i) => {
          const barY = y(bar.value)
          return (
            <rect
              key={i}
              class={`ed-sig__bar ed-sig__bar--${bar.tone ?? 'base'}`}
              x={i * bw + 1.5}
              y={barY}
              width={Math.max(0, bw - 3)}
              height={VIEW_H - barY}
              rx={1.5}
            />
          )
        })}
      </svg>
      {hasDots && (
        <div class="ed-sig__dots" aria-hidden="true">
          {bars.map((bar, i) => (
            <span key={i} class={`ed-sig__dot ed-sig__dot--${bar.dot ?? 'none'}`} />
          ))}
        </div>
      )}
      <p class="ed-sig__reading">{caption}</p>
    </div>
  )
}
