import type { ElixirMood } from '../types'

interface Props {
  line: string
  mood: ElixirMood
}

const AVATARS: Record<ElixirMood, string> = {
  neutral: '/assets/elixir-neutral.png',
  hype: '/assets/elixir-hype.png',
  unimpressed: '/assets/elixir-unimpressed.png'
}

export default function ElixirHost({ line, mood }: Props) {
  return (
    <div class="elixir-host">
      <img
        class={`elixir-host__avatar elixir-host__avatar--${mood}`}
        src={AVATARS[mood]}
        alt="Elixir"
        aria-hidden="true"
      />
      <div class="elixir-host__bubble" aria-live="polite" aria-atomic="true">
        {line}
      </div>
    </div>
  )
}
