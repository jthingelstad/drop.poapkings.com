import type { GameMode } from '@elixir-drop/contracts'
import { gameDisplay } from '../lib/game-metadata'

// The painted emblem for a game mode. One component so every visual surface —
// Home tiles, the Surge hero, leaderboard tabs, the run summary, activity rows
// — renders the same file at the same aspect, and a mode's art can never drift
// between screens.
//
// Deliberately NOT lazy-loaded: these sit above the fold on the first screen a
// player sees, and a mode tile that pops in after paint reads as a broken app.
// Width and height are always set so 6 tiles cannot reflow as they decode.
//
// The 192px file covers every size we render (60px is the largest, in the Surge
// hero), so it is the only one this component reaches for. -384 and -768 exist
// for the share card and future large surfaces.
export default function ModeIcon({ mode, size, className }: { mode: GameMode; size: number; className?: string }) {
  const { art, name } = gameDisplay(mode)
  return (
    <img
      src={art}
      width={size}
      height={size}
      // Decorative in every current placement: the mode's name is always
      // rendered as text beside it, so announcing it again is noise.
      alt=""
      aria-hidden="true"
      data-mode={mode}
      data-name={name}
      class={className ? `mode-icon ${className}` : 'mode-icon'}
    />
  )
}
