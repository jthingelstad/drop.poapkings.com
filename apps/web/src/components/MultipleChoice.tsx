import { costForGameKey, keyLegendForCost } from '../lib/game-keys'
import { useGameKeys } from '../lib/use-game-keys'

interface Props {
  choices: number[]
  onPick: (value: number) => void
  disabled?: boolean
  selected?: number | null
  correct?: number
  revealCorrect?: boolean
}

export default function MultipleChoice({
  choices,
  onPick,
  disabled,
  selected = null,
  correct,
  revealCorrect = false
}: Props) {
  useGameKeys((event) => {
    if (disabled) return
    const value = costForGameKey(event)
    if (value === null || !choices.includes(value)) return
    event.preventDefault()
    onPick(value)
  })

  return (
    <div class="mc-choices" role="group" aria-label="Elixir cost choices">
      {choices.map((n) => {
        const wrong = selected === n && correct !== undefined && n !== correct
        const right = revealCorrect && correct === n
        return (
          <button
            key={n}
            class={`mc-choices__btn${wrong ? ' mc-choices__btn--wrong' : ''}${right ? ' mc-choices__btn--correct' : ''}`}
            onClick={() => !disabled && onPick(n)}
            disabled={disabled}
            aria-keyshortcuts={`${n} ${keyLegendForCost(n)}`}
            aria-label={`${n} elixir${right ? ', correct answer' : wrong ? ', your answer, incorrect' : ''}`}
          >
            <span>{n}</span>
            <kbd class="mc-choices__shortcut" aria-hidden="true">
              {keyLegendForCost(n)}
            </kbd>
          </button>
        )
      })}
    </div>
  )
}
