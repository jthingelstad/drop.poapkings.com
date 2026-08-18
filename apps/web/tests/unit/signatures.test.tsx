import { describe, it, expect } from 'vitest'
import { renderToStringAsync } from 'preact-render-to-string'
import SignaturePanel from '../../src/components/summary/SignaturePanel'
import { surgeSignature, duelSignature } from '../../src/lib/signatures'

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
})
