// A summary signature panel: a compact bar series drawn from data the mode
// already recorded, an optional overlay line (a pace or a shrinking window) and
// optional per-bar markers, read back in one sentence. A number is not worth
// looking at twice; the shape of a run is. Pure SVG, drawn statically — it is
// information, not decoration, so reduced motion changes nothing.

export interface SignatureBar {
  value: number
  // base = neutral, bad = this bar lost (slower/wrong), gold = a highlight.
  tone?: 'base' | 'bad' | 'gold'
  // A small marker beneath the bar (right/wrong, held/missed).
  dot?: 'ok' | 'bad'
}

const VIEW_W = 300
const VIEW_H = 92

export default function SignaturePanel({
  bars,
  line,
  caption,
  max
}: {
  bars: SignatureBar[]
  // Overlay values aligned to the bars (e.g. the best run's pace, the window).
  line?: number[]
  caption: string
  max?: number
}) {
  const values = bars.map((b) => b.value)
  const peak = Math.max(1, max ?? Math.max(0, ...values, ...(line ?? [])))
  const n = Math.max(1, bars.length)
  const bw = VIEW_W / n
  const hasDots = bars.some((b) => b.dot)
  const y = (v: number) => VIEW_H - (Math.max(0, v) / peak) * VIEW_H

  return (
    <div class="ed-sig">
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
        {line && line.length > 1 && (
          <polyline
            class="ed-sig__line"
            fill="none"
            points={line.map((v, i) => `${i * bw + bw / 2},${y(v)}`).join(' ')}
          />
        )}
      </svg>
      {hasDots && (
        <div class="ed-sig__dots" aria-hidden="true">
          {bars.map((bar, i) => (
            <span key={i} class={`ed-sig__dot ed-sig__dot--${bar.dot ?? 'none'}`} />
          ))}
        </div>
      )}
      <p class="ed-sig__caption">{caption}</p>
    </div>
  )
}
