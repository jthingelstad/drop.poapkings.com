import { describe, it, expect } from 'vitest'
import { renderToStringAsync } from 'preact-render-to-string'
import SignaturePanel from '../../src/components/summary/SignaturePanel'
import { surgeSignature, duelSignature, ledgerSignature, costRecallSignature } from '../../src/lib/signatures'

describe('SignaturePanel', () => {
  it('renders one bar per datum, an overlay line, per-bar dots, and the caption', async () => {
    const html = await renderToStringAsync(
      <SignaturePanel
        bars={[
          { value: 3, tone: 'base', dot: 'ok' },
          { value: 5, tone: 'bad', dot: 'bad' }
        ]}
        line={[4, 4]}
        caption="A read-back sentence."
      />
    )
    expect((html.match(/<rect/g) ?? []).length).toBe(2)
    expect(html).toContain('ed-sig__bar--bad')
    expect(html).toContain('ed-sig__line')
    expect(html).toContain('ed-sig__dot--ok')
    expect(html).toContain('ed-sig__dot--bad')
    expect(html).toContain('A read-back sentence.')
    // The caption doubles as the chart's accessible name.
    expect(html).toContain('aria-label="A read-back sentence."')
  })
})

describe('signature builders', () => {
  it('surge marks the cards where this run lost to the best pace', () => {
    const sig = surgeSignature([1000, 1200, 900], [1100, 1000, 1000])
    // card 2 (1200 > 1000) is the only one slower than best.
    expect(sig.bars.map((b) => b.tone)).toEqual(['base', 'bad', 'base'])
    expect(sig.line).toEqual([1100, 1000, 1000])
    expect(sig.caption).toContain('1 of 3')
  })

  it('duel dots each pair right or wrong and counts the reads', () => {
    const sig = duelSignature([500, 700], [true, false])
    expect(sig.bars.map((b) => b.dot)).toEqual(['ok', 'bad'])
    expect(sig.caption).toContain('1 of 2')
  })

  it('ledger buckets accuracy by sequence length and names where the count breaks', () => {
    const sig = ledgerSignature([2, 2, 3, 3], [true, false, true, true])
    // length 2 → 1/2 = 50% (bad); length 3 → 2/2 = 100% (base). Sorted by length.
    expect(sig.bars).toEqual([
      { value: 50, tone: 'bad' },
      { value: 100, tone: 'base' }
    ])
    expect(sig.max).toBe(100)
    expect(sig.caption).toContain('2-card sequences')
  })

  it('ledger reports a clean hold when every length is strong', () => {
    const sig = ledgerSignature([2, 3], [true, true])
    expect(sig.caption).toBe('The count holds across every sequence length.')
  })

  it('cost recall marks returned cards held vs missed again', () => {
    const sig = costRecallSignature([
      { ms: 800, correct: true },
      { ms: 1200, correct: false }
    ])
    expect(sig.bars.map((b) => b.dot)).toEqual(['ok', 'bad'])
    expect(sig.bars.map((b) => b.tone)).toEqual(['base', 'bad'])
    expect(sig.caption).toBe('Held 1 of 2 cards on their return.')
  })
})
