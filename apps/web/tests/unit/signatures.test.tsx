import { describe, it, expect } from 'vitest'
import { renderToStringAsync } from 'preact-render-to-string'
import SignaturePanel, { bucketSeries } from '../../src/components/summary/SignaturePanel'
import DrillPanel from '../../src/components/summary/DrillPanel'
import {
  surgeSignature,
  rainSignature,
  survivalSignature,
  tradeSignature,
  duelSignature,
  costRecallSignature
} from '../../src/lib/signatures'

describe('SignaturePanel', () => {
  it('draws the four mandatory parts: unit, named reference with a tick, scale, and finding', async () => {
    const html = await renderToStringAsync(
      <SignaturePanel
        unit="Seconds per card"
        legend="The same card in your best run"
        badLabel="slower than your best there"
        values={[1200, 1800]}
        refs={[1500, 1500]}
        bad={[false, true]}
        reading="A read-back sentence."
      />
    )
    expect((html.match(/<rect/g) ?? []).length).toBe(2)
    expect((html.match(/ed-sig__tick/g) ?? []).length).toBe(2)
    expect(html).toContain('Seconds per card')
    expect(html).toContain('The same card in your best run')
    expect(html).toContain('ed-sig__ref-tick')
    // The scale names the peak and zero, so bar height is a quantity.
    expect(html).toContain('1.800s')
    expect(html).toContain('ed-sig__bar--bad')
    // Red is named by the mode, never inferred from the colour.
    expect(html).toContain('Red: slower than your best there')
    expect(html).toContain('A read-back sentence.')
    expect(html).toContain('aria-label="Seconds per card. A read-back sentence."')
  })

  it('omits the reference and the red legend when the run has neither', async () => {
    const html = await renderToStringAsync(
      <SignaturePanel unit="Seconds per card" legend="Unused" badLabel="unused" values={[900]} reading="Only you." />
    )
    expect(html).not.toContain('ed-sig__ref-tick')
    expect(html).not.toContain('Red:')
  })
})

describe('bucketSeries', () => {
  it('leaves a series of thirty or fewer alone', () => {
    const series = bucketSeries({ values: [1, 2, 3], bad: [false, true, false] })
    expect(series.values).toEqual([1, 2, 3])
    expect(series.bad).toEqual([false, true, false])
    expect(series.range).toBeUndefined()
  })

  it('folds a long run into thirty bars and names the range each covers', () => {
    const values = Array.from({ length: 120 }, (_, i) => (i + 1) * 10)
    const series = bucketSeries({ values, refs: values, itemNoun: 'Cards' })
    expect(series.values).toHaveLength(30)
    // Bar one is the mean of cards 1–4: (10+20+30+40)/4.
    expect(series.values[0]).toBe(25)
    expect(series.range).toEqual(['Cards 1–4', '117–120'])
  })

  it('keeps a fatal final answer as its own bar', () => {
    const values = Array.from({ length: 100 }, () => 500)
    values[99] = 4000
    const bad = values.map((_, i) => i === 99)
    const series = bucketSeries({ values, bad })
    expect(series.values).toHaveLength(30)
    expect(series.values[29]).toBe(4000)
    expect(series.bad[29]).toBe(true)
    expect(series.bad.filter(Boolean)).toHaveLength(1)
    // 99 survived answers folded into 29 bars, the fatal 100th kept whole.
    expect(series.range).toEqual(['Cards 1–3', '100'])
  })
})

describe('signature builders', () => {
  it('surge marks the cards where this run lost to the best pace', () => {
    const sig = surgeSignature([1000, 1200, 900], [1100, 1000, 1000])
    expect(sig.unit).toBe('Seconds per card')
    expect(sig.refs).toEqual([1100, 1000, 1000])
    expect(sig.bad).toEqual([false, true, false])
    expect(sig.reading).toContain('1 of 3')
  })

  it('surge without a previous best has no reference and nothing red', () => {
    const sig = surgeSignature([1000, 2000])
    expect(sig.refs).toBeUndefined()
    expect(sig.bad).toBeUndefined()
    expect(sig.reading).toContain('1.500s')
  })

  it('rain plots the read against the fall time it was racing and marks the lives', () => {
    const sig = rainSignature([800, 4200], [3000, 4200], [false, true])
    expect(sig.unit).toBe('Seconds to answer')
    expect(sig.legend).toBe('How long that card had left to fall')
    expect(sig.badLabel).toBe('a life lost')
    expect(sig.bad).toEqual([false, true])
    expect(sig.marks).toEqual([1])
    expect(sig.reading).toContain('one card')
  })

  it('survival reddens only the card that ended it, and none on a deck clear', () => {
    const dead = survivalSignature([600, 900, 1400], [2000, 1800, 1400], 2)
    expect(dead.bad).toEqual([false, false, true])
    expect(dead.reading).toContain('ended it')
    const cleared = survivalSignature([600, 900], [2000, 1800], -1)
    expect(cleared.bad).toEqual([false, false])
    expect(cleared.reading).toContain('cleared the deck')
  })

  it('trade references this run average and names a retry as the cost', () => {
    const sig = tradeSignature([1000, 3000], [0, 1])
    expect(sig.refs).toEqual([2000, 2000])
    expect(sig.badLabel).toBe('it took a retry')
    expect(sig.bad).toEqual([false, true])
    expect(sig.reading).toContain('1 of 2 exchanges')
  })

  it('duel references this run average and names a wrong read as the cost', () => {
    const sig = duelSignature([500, 700], [true, false])
    expect(sig.refs).toEqual([600, 600])
    expect(sig.badLabel).toBe('a wrong read')
    expect(sig.bad).toEqual([false, true])
    expect(sig.reading).toContain('1 of 2 reads correct')
  })
})

describe('Practice stays exempt', () => {
  it('renders a plain bar series with dots and a caption', async () => {
    const html = await renderToStringAsync(
      <DrillPanel
        bars={[
          { value: 3, tone: 'base', dot: 'ok' },
          { value: 5, tone: 'bad', dot: 'bad' }
        ]}
        caption="A read-back sentence."
      />
    )
    expect((html.match(/<rect/g) ?? []).length).toBe(2)
    expect(html).toContain('ed-sig__dot--ok')
    expect(html).toContain('ed-sig__dot--bad')
    expect(html).toContain('aria-label="A read-back sentence."')
    // No seconds grammar is forced onto a drill.
    expect(html).not.toContain('ed-sig__unit')
    expect(html).not.toContain('ed-sig__scale')
  })

  it('marks returned cards held vs missed again', () => {
    const sig = costRecallSignature([
      { ms: 800, correct: true },
      { ms: 1200, correct: false }
    ])
    expect(sig.bars.map((b) => b.dot)).toEqual(['ok', 'bad'])
    expect(sig.bars.map((b) => b.tone)).toEqual(['base', 'bad'])
    expect(sig.caption).toBe('Held 1 of 2 cards on their return.')
  })
})
