// Optional sound effects — synthesized with Web Audio, no asset files.
// Off by default; toggled in Settings. The AudioContext is created lazily on the
// first answer tap, so it's always inside a user gesture.

import { getSettings } from './storage'

let enabled = false
let ctx: AudioContext | null = null

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
  blip(540, 920, 0.16, 'sine', 0.07)
}

// A short low buzz for a wrong answer.
export function playWrong(): void {
  blip(200, 110, 0.22, 'square', 0.05)
}
