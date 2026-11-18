import { useState } from 'preact/hooks'
import { CardArt } from '../../components/CardChrome'
import Icon from '../../components/Icon'
import { dealExactTen } from './deal'

export default function ExactTen() {
  const [cards, setCards] = useState(dealExactTen)
  const [selected, setSelected] = useState<number[]>([])
  const [checked, setChecked] = useState<number | null>(null)
  const solved = checked === 10
  const chosen = cards.filter((card) => selected.includes(card.id))

  function toggle(id: number) {
    setChecked(null)
    setSelected((current) => (current.includes(id) ? current.filter((cardId) => cardId !== id) : [...current, id]))
  }

  function dealAgain() {
    setCards(dealExactTen())
    setSelected([])
    setChecked(null)
  }

  return (
    <section class="ed-exact">
      <header class="ed-exact__head">
        <a class="ed-iconbtn" aria-label="Back to Play" href="#/">
          <Icon name="x" />
        </a>
        <span class="ed-eyebrow">Untimed puzzle</span>
      </header>
      <h1>Exact Ten</h1>
      <p>Pick cards that add up to 10 elixir.</p>
      <div class="ed-exact__hand" role="group" aria-label="Your five cards">
        {cards.map((card) => {
          const active = selected.includes(card.id)
          return (
            <button
              type="button"
              key={card.id}
              class="ed-exact__card"
              aria-label={solved ? `${card.name}, ${card.elixir} elixir` : card.name}
              aria-pressed={active}
              disabled={solved}
              onClick={() => toggle(card.id)}
            >
              <CardArt
                card={card}
                className="ed-exact__art"
                imgClassName="ed-exact__img"
                fallbackClassName="ed-exact__img"
                showCost={solved}
                costClassName="ed-exact__cost"
                showName
                nameClassName="ed-exact__name"
              />
              {active && (
                <span class="ed-exact__tick" aria-hidden="true">
                  <Icon name="check" />
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div class="ed-exact__result" role="status">
        {solved
          ? `${chosen.map((card) => card.elixir).join(' + ')} = 10. Exactly!`
          : checked !== null
            ? `That adds up to ${checked}. Try another combination.`
            : `${selected.length} selected`}
      </div>
      {solved ? (
        <button
          type="button"
          class="ed-btn ed-btn--gold ed-btn--lg"
          onClick={dealAgain}
          data-tinylytics-event="puzzle.dealt_again"
          data-tinylytics-event-value="exact-ten"
        >
          Deal again
        </button>
      ) : (
        <button
          type="button"
          class="ed-btn ed-btn--gold ed-btn--lg"
          disabled={!selected.length}
          onClick={() => setChecked(chosen.reduce((sum, card) => sum + card.elixir, 0))}
        >
          Check total
        </button>
      )}
    </section>
  )
}
