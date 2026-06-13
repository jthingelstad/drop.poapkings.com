interface Props {
  onPick: (value: number) => void
  disabled?: boolean
}

export default function PipKeypad({ onPick, disabled }: Props) {
  return (
    <div class="pip-keypad" role="group" aria-label="Elixir cost keypad">
      {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
        <button
          key={n}
          class={`pip-keypad__pip${disabled ? ' pip-keypad__pip--disabled' : ''}`}
          onClick={() => !disabled && onPick(n)}
          aria-label={`${n} elixir`}
          disabled={disabled}
        >
          <span class="pl-elixir__drop" aria-hidden="true" />
          <span>{n}</span>
        </button>
      ))}
    </div>
  )
}
