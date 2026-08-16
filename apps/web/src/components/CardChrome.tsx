import type { ComponentChildren } from 'preact'
import { useState } from 'preact/hooks'
import type { Card } from '../types'
import { cardNameToneClass, classNames, type ElixirBadgeTone } from '../lib/card-rendering'

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
  overlay?: ComponentChildren
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
  nameClassName,
  overlay
}: CardArtProps) {
  const [imageState, setImageState] = useState<{ cardId: number; status: 'loading' | 'ready' | 'failed' }>({
    cardId: card.id,
    status: 'loading'
  })
  const status = imageState.cardId === card.id ? imageState.status : 'loading'
  const imgFailed = status === 'failed'
  const imgReady = status === 'ready'
  const showImage = card.icon && !imgFailed

  return (
    <span class={classNames('cr-card-art', className)}>
      {!imgReady && <span class={classNames('cr-card-art__fallback', fallbackClassName)} aria-hidden="true" />}
      {showImage && (
        <img
          key={card.id}
          class={classNames('cr-card-art__img', !imgReady && 'cr-card-art__img--loading', imgClassName)}
          src={card.icon}
          alt={alt}
          loading={loading}
          onLoad={(event) => {
            const image = event.currentTarget
            const markReady = () => setImageState({ cardId: card.id, status: 'ready' })
            if (typeof image.decode !== 'function') {
              markReady()
              return
            }
            void image.decode().then(markReady, () => setImageState({ cardId: card.id, status: 'failed' }))
          }}
          onError={() => setImageState({ cardId: card.id, status: 'failed' })}
        />
      )}
      {overlay}
      {showCost && <ElixirCostBadge elixir={card.elixir} className={costClassName} tone={costTone} />}
      {showName && <CardName card={card} className={nameClassName} />}
    </span>
  )
}
