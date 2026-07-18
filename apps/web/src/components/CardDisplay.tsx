import type { Card } from '../types'
import { cardRarityLabel, cardRarityModifier, classNames } from '../lib/card-rendering'
import { CardArt } from './CardChrome'

interface Props {
  card: Card
  phase: 'playing' | 'correct' | 'wrong'
  dropAnimKey: number
  // Surge keeps the cost hidden on a wrong answer — the card stays until correct.
  revealCost?: boolean
  // Higher/Lower forces the cost visible on reveal, without correct/wrong coloring.
  forceReveal?: boolean
  hideName?: boolean
  showMeta?: boolean
}

export default function CardDisplay({
  card,
  phase,
  dropAnimKey,
  revealCost = true,
  forceReveal = false,
  hideName = false,
  showMeta = true
}: Props) {
  const cardClass = classNames(
    'pcard',
    cardRarityModifier(card, 'pcard'),
    phase === 'correct' && 'pcard--correct',
    phase === 'wrong' && 'pcard--wrong'
  )
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
      />

      {showMeta && (
        <div class="pcard__meta">
          <span class="pill pill--purple">{card.type}</span>
          <span class={classNames('pill pill--muted cr-rarity-pill', cardRarityModifier(card, 'cr-rarity-pill'))}>
            {cardRarityLabel(card)}
          </span>
          {card.evo && <span class="pill pill--gold">Evo</span>}
          {card.hero && <span class="pill pill--gold">Hero</span>}
        </div>
      )}

      {/* Drop pop on correct */}
      {phase === 'correct' && (
        <div class="drop-pop-wrap" key={dropAnimKey}>
          <div class="drop-pop-large drop-celebrate" />
        </div>
      )}
    </div>
  )
}
