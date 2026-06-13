import type { ElixirMood } from '../types'

interface Props {
  line: string
  mood: ElixirMood
}

export default function ElixirHost({ line, mood }: Props) {
  return (
    <div class="elixir-host">
      <img
        class={`elixir-host__avatar elixir-host__avatar--${mood}`}
        src="/assets/elixir-avatar.svg"
        alt="Elixir"
        aria-hidden="true"
      />
      <div class="elixir-host__bubble" aria-live="polite" aria-atomic="true">
        {line}
      </div>
    </div>
  )
}
