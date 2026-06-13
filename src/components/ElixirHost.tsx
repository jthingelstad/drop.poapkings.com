import type { ElixirMood } from '../types'

interface Props {
  line: string
  mood: ElixirMood
}

// ── Elixir avatar art slot ─────────────────────────────────────────────────────
// Drop the real Elixir art here. Supply per-expression files (e.g.
// /assets/elixir-hype.svg) and map them below; until then every mood reuses the
// bundled placeholder, with a CSS filter giving each a distinct read.
const AVATARS: Record<ElixirMood, string> = {
  neutral: '/assets/elixir-avatar.svg',
  hype: '/assets/elixir-avatar.svg',
  unimpressed: '/assets/elixir-avatar.svg'
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
