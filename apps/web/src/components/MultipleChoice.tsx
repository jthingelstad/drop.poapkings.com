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
  return (
    <div class="mc-choices" role="group" aria-label="Elixir cost choices">
      {choices.map((n) => {
        const wrong = selected === n && correct !== undefined && n !== correct
        const right = revealCorrect && correct === n
        return (
          <button
            key={n}
            class={`btn btn--purple mc-choices__btn${wrong ? ' mc-choices__btn--wrong' : ''}${right ? ' mc-choices__btn--correct' : ''}`}
            onClick={() => !disabled && onPick(n)}
            disabled={disabled}
            aria-label={`${n} elixir${right ? ', correct answer' : wrong ? ', your answer, incorrect' : ''}`}
          >
            <img src="/assets/elixir-drop.png" alt="" class="elixir-pip" aria-hidden="true" />
            <span>{n}</span>
          </button>
        )
      })}
    </div>
  )
}
