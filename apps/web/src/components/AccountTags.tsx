import type { AccountTag } from '@elixir-drop/contracts'

const TAG_DETAILS: Record<AccountTag, { label: string; description: string }> = {
  developer: { label: 'DEV', description: 'Elixir Drop developer' }
}

export default function AccountTags({ tags }: { tags?: AccountTag[] }) {
  if (!tags?.length) return null
  return (
    <span class="ed-account-tags">
      {[...new Set(tags)].map((tag) => {
        const details = TAG_DETAILS[tag]
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
