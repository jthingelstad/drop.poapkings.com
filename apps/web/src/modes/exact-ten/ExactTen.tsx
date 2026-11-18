import { useEffect, useState } from 'preact/hooks'
import { CardArt } from '../../components/CardChrome'
import Icon from '../../components/Icon'
import { dealExactTen } from './deal'
import { sessionToken } from '../../lib/account'
import { recordExactTen, startExactTen } from '../../lib/api'
import { offline } from '../../lib/api-availability'
import { challengeCards } from '../../lib/challenge-cards'
import { cardArtForDeal } from '../../lib/card-rendering'
import type { Card } from '../../types'

export default function ExactTen() {
  const [cards, setCards] = useState<Card[]>([])
  const [round, setRound] = useState(0)
  const [handToken, setHandToken] = useState('')
  const [saveState, setSaveState] = useState<'local' | 'ready' | 'saving' | 'saved' | 'failed'>('local')
  useEffect(() => {
    let active = true
    async function deal() {
      const token = sessionToken()
      if (token && !offline.peek()) {
        try {
          const hand = await startExactTen(token)
          const dealt = challengeCards(hand.cardIds)
          if (dealt.length !== 5) throw new Error('Unknown card in hand')
          if (active) {
            setHandToken(hand.handToken)
            setCards(dealt.map(cardArtForDeal()))
            setSaveState('ready')
          }
          return
        } catch {
          /* This hand can still be played locally. */
        }
      }
      if (active) {
        setCards(dealExactTen())
        setSaveState('local')
      }
    }
    void deal()
    return () => {
      active = false
    }
  }, [round])
  async function save(ids: number[]) {
    const token = sessionToken()
    if (!handToken || !token) return
    setSaveState('saving')
    try {
      await recordExactTen(handToken, ids, token)
      setSaveState('saved')
    } catch {
      setSaveState('failed')
    }
  }
  const [selected, setSelected] = useState<number[]>([])
  const [checked, setChecked] = useState<number | null>(null)
  const solved = checked === 10
  const chosen = cards.filter((card) => selected.includes(card.id))

  function toggle(id: number) {
    setChecked(null)
    setSelected((current) => (current.includes(id) ? current.filter((cardId) => cardId !== id) : [...current, id]))
  }

  function dealAgain() {
    setCards([])
    setHandToken('')
    setSaveState('local')
    setRound((n) => n + 1)
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
      {cards.length === 0 && <p role="status">Dealing your hand…</p>}
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
      {cards.length > 0 && (
        <p>
          {saveState === 'saved'
            ? 'Game saved.'
            : saveState === 'saving'
              ? 'Saving your game…'
              : saveState === 'failed'
                ? 'Your solve is ready. Try saving again.'
                : saveState === 'local'
                  ? 'Local game'
                  : 'Played games appear on your verified player’s Elixir timeline.'}
        </p>
      )}
      {saveState === 'failed' && (
        <button type="button" class="ed-btn" onClick={() => void save(selected)}>
          Retry saving
        </button>
      )}
      {solved ? (
        <button
          type="button"
          class="ed-btn ed-btn--gold ed-btn--lg"
          disabled={saveState === 'saving'}
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
          onClick={() => {
            const total = chosen.reduce((sum, card) => sum + card.elixir, 0)
            setChecked(total)
            if (total === 10 && handToken) void save(selected)
          }}
        >
          Check total
        </button>
      )}
    </section>
  )
}
