// Shared game-screen chrome for every mode: the 3-2-1-GO countdown, the top bar
// (quit · mode + progress · metric), the progress bar, and the stage slot the
// mode fills (keypad card, duel, trade, rain). The mode owns all game logic and
// just renders its stage into `children`; this is presentation only. Matches
// design-ref/{mobile,desktop}.html.

import type { ComponentChildren } from 'preact'
import Icon from '../Icon'
import GameFxLayer from '../GameFxLayer'
import RunCountdown from '../RunCountdown'
import type { GameRuntimeCue } from '../../lib/game-runtime'

export interface GameMetric {
  value: string
  label: string
}

interface Props {
  modeName: string
  counting: boolean
  count: number
  onQuit: () => void
  cue: GameRuntimeCue | null
  progressText?: string
  metric?: GameMetric
  progressPct?: number
  fxParticles?: number
  // Survival's depleting per-card clock needs instant width (no easing) and a
  // red "running out" state.
  barTransition?: boolean
  barLow?: boolean
  // Rain fills the whole stage edge-to-edge (keypad floats over the WebGL field).
  fullBleed?: boolean
  children: ComponentChildren
}

export default function GameFrame({
  modeName,
  counting,
  count,
  onQuit,
  cue,
  progressText,
  metric,
  progressPct = 0,
  fxParticles = 16,
  barTransition = true,
  barLow = false,
  fullBleed = false,
  children
}: Props) {
  return (
    <div class="ed-game">
      <GameFxLayer cue={cue} particleCount={fxParticles} />

      {counting ? (
        <div class="ed-game__count">
          <div class="ed-game__count-mode">{modeName}</div>
          <div class="ed-game__count-num">
            <RunCountdown count={count} />
          </div>
        </div>
      ) : (
        <>
          <div class="ed-game__top">
            <div class="ed-game__top-l">
              <button class="ed-iconbtn tap-fx" onClick={onQuit} aria-label="Quit game">
                <span class="tap-face">
                  <Icon name="chevron-left" />
                </span>
              </button>
            </div>
            <div class="ed-game__top-c">
              <div class="ed-game__mode">{modeName}</div>
              {progressText && <div class="ed-game__progress">{progressText}</div>}
            </div>
            <div class="ed-game__top-r">
              {metric && (
                <>
                  <div class="ed-game__metric">{metric.value}</div>
                  <div class="ed-game__metric-label">{metric.label}</div>
                </>
              )}
            </div>
          </div>

          <div class="ed-game__bar" aria-hidden="true">
            <div
              class={`ed-game__bar-fill${barLow ? ' ed-game__bar-fill--low' : ''}`}
              style={{
                width: `${Math.max(0, Math.min(100, progressPct))}%`,
                transition: barTransition ? undefined : 'none'
              }}
            />
          </div>

          <div class={`ed-game__stage${fullBleed ? ' ed-game__stage--bleed' : ''}`}>{children}</div>
        </>
      )}
    </div>
  )
}
