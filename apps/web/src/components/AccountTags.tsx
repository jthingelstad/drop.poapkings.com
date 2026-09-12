import type { AccountTag } from '@elixir-drop/contracts'
import Icon from './Icon'

const TAG_DETAILS: Record<AccountTag, { label: string; description: string }> = {
  developer: { label: 'DEV', description: 'Elixir Drop developer' },
  // Elixir's checkmark, the same glyph and words as on elixir.poapkings.com:
  // this Clash Royale player is proven to be theirs.
  verified: { label: 'Verified', description: 'Verified in Elixir: this Clash Royale player is theirs' }
}

export default function AccountTags({ tags }: { tags?: AccountTag[] }) {
  if (!tags?.length) return null
  return (
    <span class="ed-account-tags">
      {[...new Set(tags)].map((tag) => {
        const details = TAG_DETAILS[tag]
        if (tag === 'verified')
          return (
            <span
              class="ed-account-tag ed-account-tag--verified"
              role="img"
              aria-label={details.description}
              title={details.description}
              key={tag}
            >
              <Icon name="circle-check" />
            </span>
          )
        return (
          <span
            class={`ed-account-tag ed-account-tag--${tag}`}
            aria-label={details.description}
            title={details.description}
            key={tag}
          >
            {details.label}
          </span>
        )
      })}
    </span>
  )
}
