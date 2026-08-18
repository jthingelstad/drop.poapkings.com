// The violet pill row that both Ladder and You use to switch scopes. Violet is
// the "where you are in the page" role (see the colour roles in styles.css):
// gold stays reserved for the nav pill and the one thing to press, so a scope
// row never competes with a PLAY. An optional 7px gold dot, left of the label,
// marks unread (Updates).

export interface ScopeOption<K extends string> {
  key: K
  label: string
  dot?: boolean
}

export default function ScopeRow<K extends string>({
  options,
  active,
  onSelect,
  ariaLabel
}: {
  options: ScopeOption<K>[]
  active: K
  onSelect: (key: K) => void
  ariaLabel: string
}) {
  return (
    <div class="ed-scoperow" role="tablist" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          role="tab"
          aria-selected={active === option.key}
          class={`ed-scopepill${active === option.key ? ' ed-scopepill--active' : ''}`}
          onClick={() => onSelect(option.key)}
        >
          {option.dot && <span class="ed-scopepill__dot" aria-label="Unread" />}
          {option.label}
        </button>
      ))}
    </div>
  )
}
