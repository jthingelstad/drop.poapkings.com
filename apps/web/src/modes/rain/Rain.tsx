import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import type { Card } from '../../types'
import { computeInsights, type Insights } from '../../lib/insights'
import { track } from '../../lib/analytics'
import { playRainClear, playRainMiss } from '../../lib/sound'
import { navigate } from '../../lib/router'
import { getRecords, saveRecords } from '../../lib/storage'
import { isReducedMotionEnabled } from '../../lib/motion'
import { useGameRuntime } from '../../lib/use-game-runtime'
import { useGameSession } from '../../lib/use-game-session'
import { challengePreparers } from '../../lib/game-challenge-content'
import PipKeypad from '../../components/PipKeypad'
import Summary from '../../components/Summary'
import GameRunGate from '../../components/GameRunGate'
import GameFrame from '../../components/game/GameFrame'

// Rain — cards fall; clear the lit (lowest) card's cost before it lands. Three
// lives; spawn/fall speed ramps every 5 clears. RANKED: tiles are drawn in order
// from the server's signed deck, and each RESOLVED card (cleared → guess=cost,
// landed → guess=null) is recorded in the transcript the server scores.
const MAX_CONCURRENT = 8
const SPAWN_MS = 900
const TICK_MS = 40
const RAIN_LIVES = 3
const COUNTDOWN_STEP_MS = 650

interface Drop {
  el: HTMLDivElement
  card: Card
  y: number
  speed: number
}

export default function Rain() {
  const gameRun = useGameSession('rain', challengePreparers.rain)
  const runtime = useGameRuntime({ countdownStepMs: COUNTDOWN_STEP_MS, trackElapsed: false })
  const { stage, count } = runtime
  const fieldRef = useRef<HTMLDivElement>(null)
  const drops = useRef<Drop[]>([])
  const target = useRef<Drop | null>(null)
  const rainSpd = useRef(0)
  const cursor = useRef(0)
  const spawnTimer = useRef<number | undefined>(undefined)
  const fallTimer = useRef<number | undefined>(undefined)
  const started = useRef(false)
  // Server transcript: one entry per resolved card, in resolution order.
  const serverAnswers = useRef<Array<{ cardId: number; guess: number | null }>>([])
  // Display insights (accuracy by cost) for the summary.
  const answersLog = useRef<Array<{ card: Card; correct: boolean }>>([])
  const recorded = useRef(false)

  const lives = useSignal(RAIN_LIVES)
  const score = useSignal(0)
  const insights = useSignal<Insights | null>(null)
  const best = useSignal(getRecords().rainBest ?? 0)
  const isPB = useSignal(false)

  useEffect(() => {
    track('mode.rain')
    return () => {
      if (spawnTimer.current) window.clearInterval(spawnTimer.current)
      if (fallTimer.current) window.clearInterval(fallTimer.current)
    }
  }, [])

  // Auto-start (Play → countdown) once the signed deck + art are ready; re-armed
  // on replay. begin() is reached via a ref so this only re-fires on load state.
  const beginRef = useRef<() => void>(() => {})
  beginRef.current = begin
  useEffect(() => {
    if (gameRun.content && gameRun.assetsReady && !started.current && stage.peek() === 'ready') {
      started.current = true
      beginRef.current()
    }
  }, [gameRun.content, gameRun.assetsReady, stage])

  function clearLoops() {
    if (spawnTimer.current) window.clearInterval(spawnTimer.current)
    if (fallTimer.current) window.clearInterval(fallTimer.current)
    spawnTimer.current = undefined
    fallTimer.current = undefined
  }

  async function begin() {
    if (!(await gameRun.ensureFreshRun())) return
    lives.value = RAIN_LIVES
    score.value = 0
    serverAnswers.current = []
    answersLog.current = []
    recorded.current = false
    runtime.start(() => {
      drops.current = []
      target.current = null
      rainSpd.current = 0
      cursor.current = 0
      if (fieldRef.current) fieldRef.current.innerHTML = ''
      spawnDrop()
      spawnTimer.current = window.setInterval(spawnDrop, SPAWN_MS)
      fallTimer.current = window.setInterval(tick, TICK_MS)
    })
  }

  function nextCard(): Card | null {
    const deck = gameRun.content
    if (!deck || deck.length === 0) return null
    const c = deck[cursor.current % deck.length]!
    cursor.current += 1
    return c
  }

  function spawnDrop() {
    const field = fieldRef.current
    if (!field || drops.current.length > MAX_CONCURRENT) return
    const card = nextCard()
    if (!card) return
    const el = document.createElement('div')
    el.className = 'ed-rain__tile'
    el.style.left = `${6 + Math.random() * 72}%`
    el.style.top = '-16%'
    el.innerHTML =
      `<img src="/cards/${card.id}.png" alt="" class="ed-rain__tile-img"/>` +
      `<span class="ed-rain__tile-name">${card.name}</span>`
    field.appendChild(el)
    drops.current.push({ el, card, y: -16, speed: 0.42 + Math.random() * 0.16 + rainSpd.current })
  }

  function tick() {
    if (stage.value !== 'running') return
    const survivors: Drop[] = []
    let lost = 0
    for (const d of drops.current) {
      d.y += d.speed
      if (d.y >= 96) {
        popTile(d, true)
        serverAnswers.current.push({ cardId: d.card.id, guess: null })
        answersLog.current.push({ card: d.card, correct: false })
        lost++
        continue
      }
      d.el.style.top = `${d.y}%`
      survivors.push(d)
    }
    drops.current = survivors
    // The lowest card (largest y) is the live target.
    let t: Drop | null = null
    for (const d of drops.current) if (!t || d.y > t.y) t = d
    target.current = t
    for (const d of drops.current) d.el.classList.toggle('ed-rain__tile--lit', d === t)
    if (lost) {
      const next = lives.value - lost
      lives.value = next
      playRainMiss()
      if (next <= 0) endRain()
    }
  }

  function popTile(d: Drop, missed: boolean) {
    const el = d.el
    if (!el) return
    if (isReducedMotionEnabled()) {
      el.remove()
      return
    }
    el.classList.add(missed ? 'ed-rain__tile--miss' : 'ed-rain__tile--clear')
    el.addEventListener('animationend', () => el.remove(), { once: true })
    window.setTimeout(() => el.remove(), 500)
  }

  function answer(value: number) {
    if (stage.value !== 'running') return
    const t = target.current
    if (!t) return
    if (value === t.card.elixir) {
      popTile(t, false)
      drops.current = drops.current.filter((x) => x !== t)
      target.current = null
      serverAnswers.current.push({ cardId: t.card.id, guess: t.card.elixir })
      answersLog.current.push({ card: t.card, correct: true })
      const next = score.value + 1
      score.value = next
      rainSpd.current = Math.min(0.6, Math.floor(next / 5) * 0.06)
      playRainClear()
    } else {
      // A wrong tap does not resolve the card — it stays and keeps falling.
      t.el.classList.remove('ed-rain__shake')
      void t.el.offsetWidth
      t.el.classList.add('ed-rain__shake')
    }
  }

  function endRain() {
    clearLoops()
    runtime.later(finish, 200)
  }

  function finish() {
    clearLoops()
    if (recorded.current) return
    recorded.current = true
    const prev = getRecords().rainBest
    const pb = score.value > (prev ?? 0)
    best.value = prev ?? 0
    isPB.value = pb
    insights.value = computeInsights(
      answersLog.current.map((a) => ({ card: a.card, guess: a.correct ? a.card.elixir : 0, correct: a.correct }))
    )
    if (pb) {
      saveRecords({ rainBest: score.value })
      track('record.new')
    }
    track('rain.complete')
    runtime.finish('over')
    // Record the ranked run on the server (guest → scored, not persisted).
    void gameRun.complete({ answers: serverAnswers.current })
  }

  function replay() {
    clearLoops()
    started.current = false
    insights.value = null
    runtime.reset('ready')
    void gameRun.prepare()
  }

  if (!gameRun.content) {
    return (
      <GameRunGate preparing={gameRun.preparing.value} error={gameRun.error} onRetry={() => void gameRun.prepare()} />
    )
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  if (stage.value === 'over' && insights.value) {
    const pbCallout = isPB.value
      ? best.value > 0
        ? `New best! +${score.value - best.value}`
        : 'First Rain logged'
      : best.value > 0
        ? `Best: ${best.value}`
        : undefined
    return (
      <div class="ed-gamewrap">
        <Summary
          eyebrow="The rain stopped"
          headline={`${score.value} cleared`}
          pbCallout={pbCallout}
          insights={insights.value}
          moments={[
            { label: 'Cleared', value: String(score.value) },
            { label: 'Prev best', value: String(best.value), tone: 'purple' },
            { label: 'Accuracy', value: `${insights.value.accuracyPct}%`, tone: 'green' }
          ]}
          onReplay={replay}
          replayLabel="Play again"
          onHome={() => navigate('/')}
        />
      </div>
    )
  }

  // ── Loading (pre-countdown) ───────────────────────────────────────────────
  if (stage.value === 'ready') {
    return (
      <div class="ed-gamewrap ed-gameloading" aria-live="polite">
        <span class="ed-drop-shape ed-gameloading__drop" aria-hidden="true" />
        <span>Loading cards…</span>
      </div>
    )
  }

  const counting = stage.value !== 'running'
  const hearts = '♥'.repeat(Math.max(0, lives.value)) + '♡'.repeat(Math.max(0, RAIN_LIVES - lives.value))
  return (
    <GameFrame
      modeName="Rain"
      counting={counting}
      count={count.value}
      onQuit={() => navigate('/')}
      cue={runtime.cue.value}
      fxParticles={6}
      progressText={hearts}
      metric={{ value: String(score.value), label: 'cleared' }}
      progressPct={(lives.value / RAIN_LIVES) * 100}
      fullBleed
    >
      <div class="ed-rain">
        <div ref={fieldRef} class="ed-rain__field" aria-hidden="true" />
        <div class="ed-rain__hint">Clear the lit card before it lands</div>
        <div class="ed-rain__pad">
          <PipKeypad onPick={answer} disabled={counting} />
        </div>
      </div>
    </GameFrame>
  )
}
