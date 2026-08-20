import { useEffect, useRef } from 'preact/hooks'
import { layout } from '../lib/use-layout'
import { closeKeyboardHelp, keyboardHelpOpen, openKeyboardHelp } from '../lib/keyboard-help'
import { useGameKeys } from '../lib/use-game-keys'
import { keyLegendRow } from '../lib/game-keys'
import Icon from './Icon'

export default function KeyboardHelp() {
  const closeRef = useRef<HTMLButtonElement>(null)
  const open = keyboardHelpOpen.value

  useGameKeys((event) => {
    if (layout.value !== 'desktop') return
    if (event.key === '?') {
      event.preventDefault()
      // GameFrame also listens on window for Escape. Consume a guide key here
      // so closing the modal cannot fall through and arm "Esc again to quit".
      event.stopImmediatePropagation()
      if (open) closeKeyboardHelp()
      else openKeyboardHelp()
      return
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopImmediatePropagation()
      closeKeyboardHelp()
    }
  })

  useEffect(() => {
    if (open) closeRef.current?.focus({ preventScroll: true })
  }, [open])

  if (layout.value !== 'desktop' || !open) return null

  // The player's own legend where the browser resolves it, US letters otherwise.
  const keys = keyLegendRow()

  return (
    <div class="ed-keyhelp" role="presentation" onClick={closeKeyboardHelp}>
      <section
        class="ed-keyhelp__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-help-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header class="ed-keyhelp__head">
          <div>
            <span class="ed-keyhelp__eyebrow">Desktop controls</span>
            <h2 id="keyboard-help-title">Keep both hands home</h2>
          </div>
          <button ref={closeRef} class="ed-iconbtn" onClick={closeKeyboardHelp} aria-label="Close keyboard controls">
            <Icon name="x" />
          </button>
        </header>
        <div class="ed-keyhelp__mapping" aria-label="Elixir cost keyboard mapping">
          <div class="ed-keyhelp__keys" aria-hidden="true">
            {keys.map((key, index) => (
              <kbd key={`${key}-${index}`}>{key}</kbd>
            ))}
          </div>
          <div class="ed-keyhelp__costs" aria-hidden="true">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((cost) => (
              <span key={cost}>{cost}</span>
            ))}
          </div>
          <p>
            {keys.slice(0, 5).join(' ')} answer 1–5. {keys.slice(5).join(' ')} answer 6–9. The number row works too.
          </p>
        </div>
        <dl class="ed-keyhelp__list">
          <div>
            <dt>
              <kbd>Space</kbd>
            </dt>
            <dd>Play again or take the screen’s primary action.</dd>
          </div>
          <div>
            <dt>
              <kbd>↑</kbd> <kbd>↓</kbd>
            </dt>
            <dd>Choose the top or bottom card in Higher / Lower.</dd>
          </div>
          <div>
            <dt>
              <kbd>Esc</kbd>
            </dt>
            <dd>Focus quit; press it again to abandon the run.</dd>
          </div>
          <div>
            <dt>
              <kbd>?</kbd>
            </dt>
            <dd>Open or close this guide.</dd>
          </div>
        </dl>
      </section>
    </div>
  )
}
