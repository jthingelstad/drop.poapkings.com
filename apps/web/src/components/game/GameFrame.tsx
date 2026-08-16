// Shared game-screen chrome for every mode: the 3-2-1-GO countdown, the top bar
// (quit · mode + progress · metric), the progress bar, and the stage slot the
// mode fills (keypad card, duel, trade, rain). The mode owns all game logic and
// just renders its stage into `children`; this is presentation only. Matches
// design-ref/{mobile,desktop}.html.

import type { ComponentChildren } from 'preact'
import Icon from '../Icon'
import GameFxLayer from '../GameFxLayer'
import type { GameRuntimeCue } from '../../lib/game-runtime'
import { offlineRunMode } from '../../lib/use-game-run'
import { GameStartStage } from './GameStart'

export interface GameMetric {
  value: string
  label: string
}

interface Props {
  modeName: string
  counting: boolean
  count: number
  onQuit: () => void
  // An endless mode has no last card, so its exit affordance IS the "I'm done"
  // control and has to say so. Supplying a label renders the same top-left
  // button with words beside the chevron ("End session") rather than adding a
  // second, competing control to the bar.
  quitLabel?: string
  cue: GameRuntimeCue | null
  // Usually a plain string ("Card 3 / 15"); Rain renders its lives as glyphs.
  progressText?: ComponentChildren
  metric?: GameMetric
  // Omit for endless learning surfaces with no destination. Rendering an
  // accuracy fill in Practice made a score out of a deliberately unscored mode.
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
  quitLabel,
  cue,
  progressText,
  metric,
  progressPct,
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
        <GameStartStage modeName={modeName} phase="countdown" count={count} />
      ) : (
        <>
          <div class="ed-game__top">
            <div class="ed-game__top-l">
              <button
                class={`ed-iconbtn tap-fx${quitLabel ? ' ed-iconbtn--labeled' : ''}`}
                onClick={onQuit}
                aria-label={quitLabel ?? 'Quit game'}
              >
                <span class="tap-face">
                  <Icon name="chevron-left" />
                  {quitLabel && <span class="ed-iconbtn__label">{quitLabel}</span>}
                </span>
              </button>
            </div>
            <div class="ed-game__top-c">
              <div class="ed-game__mode">{modeName}</div>
              {offlineRunMode.value && <div class="ed-game__offline">Offline · not saved</div>}
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

          {progressPct !== undefined && (
            <div class="ed-game__bar" aria-hidden="true">
              <div
                class={`ed-game__bar-fill${barLow ? ' ed-game__bar-fill--low' : ''}`}
                style={{
                  width: `${Math.max(0, Math.min(100, progressPct))}%`,
                  transition: barTransition ? undefined : 'none'
                }}
              />
            </div>
          )}

          <div class={`ed-game__stage${fullBleed ? ' ed-game__stage--bleed' : ''}`}>{children}</div>
        </>
      )}
    </div>
  )
}
