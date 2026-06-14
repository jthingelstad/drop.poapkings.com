import { useState } from 'preact/hooks'
import type { Card } from '../types'

interface Props {
  card: Card
  phase: 'playing' | 'correct' | 'wrong'
  dropAnimKey: number
  // Surge keeps the cost hidden on a wrong answer — the card stays until correct.
  revealCost?: boolean
  // Higher/Lower forces the cost visible on reveal, without correct/wrong coloring.
  forceReveal?: boolean
}

export default function CardDisplay({ card, phase, dropAnimKey, revealCost = true, forceReveal = false }: Props) {
  const [imgFailed, setImgFailed] = useState(false)
  const [prevId, setPrevId] = useState(card.id)

  // Reset image state when card changes
  if (prevId !== card.id) {
    setPrevId(card.id)
    setImgFailed(false)
  }

  const cardClass = ['pcard', phase === 'correct' ? 'pcard--correct' : '', phase === 'wrong' ? 'pcard--wrong' : '']
    .filter(Boolean)
    .join(' ')

  const showImg = card.icon && !imgFailed

  return (
    <div class={cardClass} style={{ position: 'relative' }}>
      {/* Elixir cost badge */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          right: 14,
          background: 'rgba(109,40,217,0.85)',
          border: '1.5px solid var(--purple)',
          borderRadius: 'var(--r-sm)',
          padding: '4px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '1rem',
          color: 'var(--ink)',
          visibility: forceReveal || (phase !== 'playing' && revealCost) ? 'visible' : 'hidden'
        }}
      >
        <img src="/assets/elixir-drop.png" alt="" class="elixir-pip" aria-hidden="true" />
        <span style={{ marginTop: 1 }}>{card.elixir}</span>
      </div>

      <div class="pcard__art">
        {showImg ? (
          <img key={card.id} class="pcard__img" src={card.icon} alt={card.name} onError={() => setImgFailed(true)} />
        ) : (
          <div class="pcard__fallback" aria-hidden="true" />
        )}

        <div class="pcard__name">{card.name}</div>
      </div>

      <div class="pcard__meta">
        <span class="pill pill--purple">{card.type}</span>
        <span class="pill pill--muted">{card.rarity}</span>
        {card.evo && <span class="pill pill--gold">Evo</span>}
        {card.hero && <span class="pill pill--gold">Hero</span>}
      </div>

      {/* Drop pop on correct */}
      {phase === 'correct' && (
        <div class="drop-pop-wrap" key={dropAnimKey}>
          <div class="drop-pop-large drop-celebrate" />
        </div>
      )}
    </div>
  )
}
