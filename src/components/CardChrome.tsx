import { useState } from 'preact/hooks'
import type { Card } from '../types'
import { cardNameToneClass, cardRarityModifier, classNames, type ElixirBadgeTone } from '../lib/card-rendering'

interface ElixirCostBadgeProps {
  elixir: number
  className?: string
  tone?: ElixirBadgeTone
}

interface CardNameProps {
  card: Card
  className?: string
}

interface CardArtProps {
  card: Card
  className: string
  imgClassName: string
  fallbackClassName: string
  alt?: string
  loading?: 'eager' | 'lazy'
  showCost?: boolean
  costClassName?: string
  costTone?: ElixirBadgeTone
  showName?: boolean
  nameClassName?: string
}

export function ElixirCostBadge({ elixir, className, tone = 'default' }: ElixirCostBadgeProps) {
  return (
    <span
      class={classNames('cr-elixir-badge', tone === 'wrong' && 'cr-elixir-badge--wrong', className)}
      aria-label={`${elixir} elixir`}
    >
      <img src="/assets/elixir-drop.png" alt="" class="elixir-pip" aria-hidden="true" />
      {elixir}
    </span>
  )
}

export function CardName({ card, className }: CardNameProps) {
  return <span class={classNames('cr-card-name', cardNameToneClass(card), className)}>{card.name}</span>
}

export function CardArt({
  card,
  className,
  imgClassName,
  fallbackClassName,
  alt = '',
  loading = 'lazy',
  showCost = false,
  costClassName,
  costTone = 'default',
  showName = false,
  nameClassName
}: CardArtProps) {
  const [imageState, setImageState] = useState({ cardId: card.id, failed: false })
  const imgFailed = imageState.cardId === card.id && imageState.failed
  const showImage = card.icon && !imgFailed

  return (
    <span class={classNames('cr-card-art', cardRarityModifier(card, 'cr-card-art'), className)}>
      {showImage ? (
        <img
          key={card.id}
          class={classNames('cr-card-art__img', imgClassName)}
          src={card.icon}
          alt={alt}
          loading={loading}
          onError={() => setImageState({ cardId: card.id, failed: true })}
        />
      ) : (
        <span class={classNames('cr-card-art__fallback', fallbackClassName)} aria-hidden="true" />
      )}
      {showCost && <ElixirCostBadge elixir={card.elixir} className={costClassName} tone={costTone} />}
      {showName && <CardName card={card} className={nameClassName} />}
    </span>
  )
}
