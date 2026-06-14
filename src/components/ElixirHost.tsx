import type { ElixirMood } from '../types'

interface Props {
  line: string
  mood: ElixirMood
}

const AVATARS: Record<ElixirMood, string> = {
  neutral:     '/assets/emoji/elixir.png',
  thinking:    '/assets/emoji/elixir_thinking.png',
  happy:       '/assets/emoji/elixir_happy.png',
  hype:        '/assets/emoji/elixir_hype.png',
  celebrate:   '/assets/emoji/elixir_celebrate.png',
  angry:       '/assets/emoji/elixir_angry.png',
  facepalm:    '/assets/emoji/elixir_facepalm.png',
  unimpressed: '/assets/emoji/elixir_facepalm.png',
  trophy:      '/assets/emoji/elixir_trophy.png',
  gg:          '/assets/emoji/elixir_gg.png',
  time:        '/assets/emoji/elixir_time.png',
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
