interface Props {
  choices: number[]
  onPick: (value: number) => void
  disabled?: boolean
}

export default function MultipleChoice({ choices, onPick, disabled }: Props) {
  return (
    <div class="mc-choices" role="group" aria-label="Elixir cost choices">
      {choices.map((n) => (
        <button
          key={n}
          class="btn btn--purple mc-choices__btn"
          onClick={() => !disabled && onPick(n)}
          disabled={disabled}
          aria-label={`${n} elixir`}
        >
          <span class="pl-elixir__drop" aria-hidden="true" />
          <span>{n}</span>
        </button>
      ))}
    </div>
  )
}
