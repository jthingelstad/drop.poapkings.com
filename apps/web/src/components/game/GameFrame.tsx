// Shared game-screen chrome for every mode: the 3-2-1-GO countdown, the top bar
// (quit · mode + progress · metric), the progress bar, and the stage slot the
// mode fills (keypad card, duel, trade, rain). The mode owns all game logic and
// just renders its stage into `children`; this is presentation only. Matches
// design-ref/{mobile,desktop}.html.

import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import Icon from '../Icon'
import GameFxLayer from '../GameFxLayer'
import type { GameRuntimeCue } from '../../lib/game-runtime'
import { offlineRunMode } from '../../lib/use-game-run'
import { GameStartStage } from './GameStart'
import { useGameKeys } from '../../lib/use-game-keys'
import { isInteractiveKeyTarget, isSpaceKey } from '../../lib/game-keys'
import { keyboardHelpOpen, openKeyboardHelp } from '../../lib/keyboard-help'
import { layout } from '../../lib/use-layout'

export interface GameMetric {
  value: string
  label: string
}

interface Props {
  modeName: string
  counting: boolean
  count: number
  onQuit: () => void
  // The quit control is an X everywhere — leaving a run abandons it, and a back
  // arrow would promise the run is still there. Only the accessible name differs:
  // "Abandon run" for ranked modes (the default), "End session" for the drills.
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
  quitLabel = 'Abandon run',
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
  const quitRef = useRef<HTMLButtonElement>(null)
  const [quitArmed, setQuitArmed] = useState(false)

  useEffect(() => {
    if (!quitArmed) return
    const timer = window.setTimeout(() => setQuitArmed(false), 2200)
    return () => window.clearTimeout(timer)
  }, [quitArmed])

  useGameKeys((event) => {
    if (keyboardHelpOpen.value) return
    if (isSpaceKey(event) && !isInteractiveKeyTarget(event.target)) {
      // Space is deliberately inert during a question/countdown, but it must
      // not scroll the fixed game viewport.
      event.preventDefault()
      return
    }
    if (event.key !== 'Escape' || counting) return
    event.preventDefault()
    if (quitArmed || document.activeElement === quitRef.current) {
      setQuitArmed(false)
      onQuit()
      return
    }
    setQuitArmed(true)
    quitRef.current?.focus({ preventScroll: true })
  })

  return (
    <div class="ed-game">
      <GameFxLayer cue={cue} particleCount={fxParticles} />

      {counting ? (
        <GameStartStage modeName={modeName} phase="countdown" count={count} />
      ) : (
        <>
          <div class="ed-game__top">
            <div class="ed-game__top-l">
              <button ref={quitRef} class="ed-iconbtn tap-fx" onClick={onQuit} aria-label={quitLabel}>
                <span class="tap-face">
                  <Icon name="x" />
                </span>
              </button>
              {layout.value === 'desktop' && (
                <button
                  class="ed-iconbtn ed-game__help"
                  onClick={openKeyboardHelp}
                  aria-label="Keyboard controls"
                  aria-keyshortcuts="?"
                >
                  ?
                </button>
              )}
              {quitArmed && (
                <span class="ed-game__quit-hint" role="status">
                  Esc again to quit
                </span>
              )}
            </div>
            <div class="ed-game__top-c">
              <div class="ed-game__mode">{modeName}</div>
              {progressText && <div class="ed-game__progress">{progressText}</div>}
              {offlineRunMode.value && <div class="ed-game__offline">Offline · not saved</div>}
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
