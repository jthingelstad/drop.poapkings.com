import { useSignal } from '@preact/signals'
import rawCards from '@elixir-drop/game-data/cards.json'
import PlayerAvatar from '../components/PlayerAvatar'
import { avatarCrop, hasAvatarCropOverride } from '../data/avatar-crops'
import type { CardsData } from '../types'

type AvatarSize = 'small' | 'medium' | 'large'

const cards = [...(rawCards as CardsData).cards].sort((left, right) => left.name.localeCompare(right.name))
const sizes: Array<{ value: AvatarSize; label: string; pixels: number }> = [
  { value: 'small', label: 'Header', pixels: 30 },
  { value: 'medium', label: 'Leaderboard', pixels: 52 },
  { value: 'large', label: 'Profile', pixels: 104 }
]

export default function AvatarAudit() {
  const size = useSignal<AvatarSize>('medium')
  const search = useSignal('')
  const query = search.value.trim().toLocaleLowerCase()
  const visibleCards = query ? cards.filter((card) => card.name.toLocaleLowerCase().includes(query)) : cards

  return (
    <div class="main-content avatar-audit">
      <div class="avatar-audit__head">
        <div class="eyebrow">Development tool</div>
        <h1>Avatar crop audit</h1>
        <p class="lede">Review every canonical card through the same circular crop used by player profiles.</p>
      </div>

      <div class="avatar-audit__controls">
        <label class="card-search">
          <span>Find a card</span>
          <input
            type="search"
            value={search.value}
            placeholder="Search all cards"
            onInput={(event) => (search.value = event.currentTarget.value)}
          />
        </label>
        <div class="avatar-size-picker" aria-label="Avatar display size">
          {sizes.map((option) => (
            <button
              key={option.value}
              class={
                size.value === option.value
                  ? 'avatar-size-picker__option avatar-size-picker__option--active'
                  : 'avatar-size-picker__option'
              }
              aria-pressed={size.value === option.value}
              onClick={() => (size.value = option.value)}
            >
              {option.label} · {option.pixels}px
            </button>
          ))}
        </div>
      </div>

      <p class="avatar-audit__count" role="status">
        {visibleCards.length} cards · {sizes.find((option) => option.value === size.value)?.pixels}px
      </p>

      <div class={`avatar-audit__grid avatar-audit__grid--${size.value}`}>
        {visibleCards.map((card) => {
          const crop = avatarCrop(card.id)
          return (
            <article class="avatar-audit-card" data-card-id={card.id} key={card.id}>
              <PlayerAvatar favoriteCardId={card.id} size={size.value} />
              <strong>{card.name}</strong>
              <small>
                {hasAvatarCropOverride(card.id) ? 'Custom' : 'Default'} · {crop.x}/{crop.y} · {crop.scale.toFixed(2)}×
              </small>
            </article>
          )
        })}
      </div>

      {!visibleCards.length && <p class="avatar-audit__empty">No cards match that search.</p>}
    </div>
  )
}
