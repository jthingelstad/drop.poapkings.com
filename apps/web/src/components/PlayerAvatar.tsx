import type { CSSProperties } from 'preact'
import { useState } from 'preact/hooks'
import { avatarCrop } from '../data/avatar-crops'
import { challengeCard } from '../lib/challenge-cards'

// A player's profile picture: the circular crop of the Clash Royale card they
// set as their picture in Elixir (2026-11-14; before, Drop's own Player Card).
// The prop keeps the stored field's name, favoriteCardId. The art is Drop's
// committed copy, drawn whole and cropped by CSS, never altered.
//
// The app's own drop mark, shown when a player has no picture or its art is
// missing.
const DROP_ICON = '/assets/icon/drop-icon-192.png'

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
      } as CSSProperties)
    : undefined
  return (
    <span
      class={`player-avatar player-avatar--${size}${useFallback ? ' player-avatar--fallback' : ''}${className ? ` ${className}` : ''}`}
      style={style}
    >
      <img
        src={useFallback ? DROP_ICON : card.icon}
        alt={card ? `${card.name} profile picture` : 'Elixir Drop player'}
        loading="lazy"
        onError={card && !imageFailed ? () => setFailedCardId(card.id) : undefined}
      />
    </span>
  )
}
