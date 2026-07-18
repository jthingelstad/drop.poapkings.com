import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import { avatarCrop } from '../data/avatar-crops'
import { challengeCard } from '../lib/challenge-cards'

interface PlayerAvatarProps {
  favoriteCardId?: number
  size?: 'small' | 'medium' | 'large'
  class?: string
}

export default function PlayerAvatar({ favoriteCardId, size = 'medium', class: className }: PlayerAvatarProps) {
  const card = favoriteCardId === undefined ? undefined : challengeCard(favoriteCardId)
  const [failedCardId, setFailedCardId] = useState<number | undefined>(undefined)
  const imageFailed = card !== undefined && failedCardId === card.id
  const useFallback = !card || imageFailed
  const crop = card && !imageFailed ? avatarCrop(card.id) : undefined
  const style = crop
    ? ({
        '--avatar-x': `${crop.x}%`,
        '--avatar-y': `${crop.y}%`,
        '--avatar-scale': crop.scale
      } as JSX.CSSProperties)
    : undefined
  return (
    <span
      class={`player-avatar player-avatar--${size}${useFallback ? ' player-avatar--fallback' : ''}${className ? ` ${className}` : ''}`}
      style={style}
    >
      <img
        src={useFallback ? '/assets/emoji/elixir.png' : card.icon}
        alt={card ? `${card.name} favorite card` : 'Elixir Drop player'}
        loading="lazy"
        onError={card && !imageFailed ? () => setFailedCardId(card.id) : undefined}
      />
    </span>
  )
}
