import type { Card } from '../types'
import { classNames } from '../lib/card-rendering'
import { CardArt } from './CardChrome'

interface Props {
  card: Card
  phase: 'playing' | 'correct' | 'wrong'
  // Surge keeps the cost hidden on a wrong answer — the card stays until correct.
  revealCost?: boolean
  // Higher/Lower forces the cost visible on reveal, without correct/wrong coloring.
  forceReveal?: boolean
  hideName?: boolean
  // Practice reinforces a solved card with a visually separate correct-cost
  // badge, kept attached through the solved card's exit.
  reinforceCost?: boolean
}

export default function CardDisplay({
  card,
  phase,
  revealCost = true,
  forceReveal = false,
  hideName = false,
  reinforceCost = false
}: Props) {
  const cardClass = classNames('pcard', phase === 'correct' && 'pcard--correct', phase === 'wrong' && 'pcard--wrong')
  const showCost = forceReveal || (phase !== 'playing' && revealCost)

  return (
    <div class={cardClass}>
      <CardArt
        card={card}
        className="pcard__art"
        imgClassName="pcard__img"
        fallbackClassName="pcard__fallback"
        alt={hideName ? '' : card.name}
        loading="eager"
        showCost={showCost}
        costClassName="pcard__cost"
        showName={!hideName}
        nameClassName="pcard__name"
        overlay={
          reinforceCost ? (
            <span class="pcard__answer-reveal" aria-hidden="true">
              <span class="pcard__answer-label">Correct cost</span>
              <span class="pcard__answer-value">
                <img src="/assets/elixir-drop.png" alt="" class="pcard__answer-pip" />
                <span class="pcard__answer-cost">{card.elixir}</span>
              </span>
              <span class="pcard__answer-unit">Elixir</span>
            </span>
          ) : undefined
        }
      />
    </div>
  )
}
