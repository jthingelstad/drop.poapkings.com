// Optional sound effects — synthesized with Web Audio, no asset files.
// Off by default; toggled in Settings. The AudioContext is created lazily on the
// first answer tap, so it's always inside a user gesture.

import { getSettings } from './storage'
import { isReducedMotionEnabled } from './motion'

let enabled = false
let ctx: AudioContext | null = null

// Mobile haptics. Gated on reduced motion (a calm-preference cue), independent
// of the sound toggle, and a no-op where the Vibration API is absent.
function haptic(pattern: number | number[]): void {
  if (isReducedMotionEnabled()) return
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // ignore — vibration is best-effort
  }
}

export function initSound(): void {
  enabled = getSettings().sound
}

export function setSoundEnabled(on: boolean): void {
  enabled = on
}

function audio(): AudioContext | null {
  if (!enabled) return null
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      ctx = new AC()
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function blip(from: number, to: number, dur: number, type: OscillatorType, gain: number): void {
  const ac = audio()
  if (!ac) return
  const osc = ac.createOscillator()
  const g = ac.createGain()
  const t = ac.currentTime
  osc.type = type
  osc.frequency.setValueAtTime(from, t)
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur)
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g).connect(ac.destination)
  osc.start(t)
  osc.stop(t + dur)
}

// A bright rising drop for a correct answer.
export function playCorrect(): void {
  haptic(12)
  blip(540, 920, 0.16, 'sine', 0.07)
}

// A short low buzz for a wrong answer.
export function playWrong(): void {
  haptic([10, 40, 14])
  blip(200, 110, 0.22, 'square', 0.05)
}

// A soft key click on every keypad/answer tap (haptic + optional blip).
export function playTap(): void {
  haptic(8)
  blip(430, 470, 0.045, 'triangle', 0.03)
}

// Countdown ticks and the GO chime.
export function playCountdownTick(): void {
  blip(660, 660, 0.08, 'sine', 0.05)
}
export function playGo(): void {
  haptic(20)
  blip(880, 1240, 0.2, 'sine', 0.08)
}

// Rain: a bright clear vs a life-lost thud.
export function playRainClear(): void {
  haptic(10)
  blip(620, 1040, 0.14, 'sine', 0.06)
}
export function playRainMiss(): void {
  haptic([12, 30, 12])
  blip(240, 90, 0.26, 'sawtooth', 0.06)
}
