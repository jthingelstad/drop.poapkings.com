import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { rainSpawnIntervalMs } from '@elixir-drop/contracts'
import type { Card } from '../../types'
import { computeInsights, type Insights } from '../../lib/insights'
import { track } from '../../lib/analytics'
import { playRainClear, playRainMiss } from '../../lib/sound'
import { navigate } from '../../lib/router'
import { getRecords } from '../../lib/storage'
import { isReducedMotionEnabled } from '../../lib/motion'
import { comparableBest, pbCallout } from '../../lib/pb-callout'
import { useAutoStart } from '../../lib/use-auto-start'
import { useGameRuntime } from '../../lib/use-game-runtime'
import { useGameSession } from '../../lib/use-game-session'
import { challengePreparers } from '../../lib/game-challenge-content'
import PipKeypad from '../../components/PipKeypad'
import Summary from '../../components/Summary'
import GameRunGate from '../../components/GameRunGate'
import GameFrame from '../../components/game/GameFrame'
import GameLoading from '../../components/game/GameLoading'
import FloatingCue from '../../components/FloatingCue'
import Icon from '../../components/Icon'
import LivesRow from '../../components/LivesRow'
import RainMilestone from './RainMilestone'

// Rain — cards fall; clear the lit (lowest) card's cost before it lands. Three
// lives. RANKED: tiles are drawn in order from the server's signed deck (wrapping
// when it runs out — Rain is endless), and each RESOLVED card (cleared →
// guess=cost, landed → guess=null) is recorded in the transcript the server
// scores, stamped with the elapsed time at resolution and the wrong taps it cost.
//
// Difficulty scales with cleared count (demonstrated skill) and NEVER caps, on
// BOTH axes: cards fall faster AND spawn closer together as you clear more. It
// starts a touch gentler than a fixed pace and then ramps without limit, so a
// player in flow keeps accelerating until the field outruns human reaction and
// the run ends — you cannot play forever. Both curves key off the live score, so
// difficulty only advances when you actually clear cards (struggling is
// self-forgiving). See rainFallBoost / rainSpawnMs for the tuning.
const MAX_CONCURRENT = 8
const TICK_MS = 40
const RAIN_LIVES = 3
const COUNTDOWN_STEP_MS = 700

// Fall speed = RAIN_BASE_SPEED + per-drop jitter + rainFallBoost(score), in field
// %-per-tick. A card falls 112 units, so time ≈ 4480ms / speed. At score 0 that
// is ~9–12s (gentler than before); the linear+quadratic boost has no ceiling, so
// the deep game turns brutal (~0.7s/card in the high 200s ≈ impossible).
//
// This axis stays local on purpose: the jitter makes it non-deterministic, so it
// can play no part in the server's minimum-time floor. The SPAWN axis is shared —
// `rainSpawnIntervalMs` comes from packages/contracts, which is what the scorer
// computes that floor from.
const RAIN_BASE_SPEED = 0.36
const RAIN_SPEED_JITTER = 0.14
const RAIN_FALL_LINEAR = 0.011
const RAIN_FALL_QUAD = 0.00003
function rainFallBoost(score: number): number {
  return score * RAIN_FALL_LINEAR + score * score * RAIN_FALL_QUAD
}

// Progress flash: every 10th clear, the running total pulses briefly in the
// middle of the field so the player feels the count without reading the top bar.
const RAIN_MILESTONE_EVERY = 10
const RAIN_MILESTONE_MS = 500

// Wrong taps recorded per card. A wrong tap does not resolve the card, so a
// single tile can legitimately take several — but the transcript is not a place
// to mash without limit, and the scorer rejects a higher count.
const MAX_WRONG_PER_CARD = 60

interface Drop {
  el: HTMLDivElement
  card: Card
  y: number
  speed: number
  // Wrong taps spent on this card so far; rides into the transcript when it
  // resolves and feeds the leaderboard's first tiebreak.
  wrong: number
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
  // Server transcript: one entry per resolved card, in resolution order, each
  // stamped with the elapsed time at resolution. `atMs` is what lets the scorer
  // check the run against the shared spawn curve (a tile cannot be answered
  // before it can spawn) and derive the clear-latency tiebreak.
  const serverAnswers = useRef<Array<{ cardId: number; guess: number | null; atMs: number; wrongGuesses: number }>>([])
  // Display insights (accuracy by cost) for the summary.
  const answersLog = useRef<Array<{ card: Card; correct: boolean }>>([])
  const recorded = useRef(false)

  const lives = useSignal(RAIN_LIVES)
  const score = useSignal(0)
  // Directional hint after a wrong tap (like Surge): aim higher or lower.
  const hint = useSignal<'higher' | 'lower' | null>(null)
  const hintPulse = useSignal(0)
  // Every-10-clears progress flash in the middle of the field (null = nothing showing).
  const milestone = useSignal<number | null>(null)
  const insights = useSignal<Insights | null>(null)
  // The record standing BEFORE this run — the number the summary compares
  // against. Never overwritten with the score just set.
  const prevBest = useSignal(comparableBest(getRecords().rainBest))
  const isPB = useSignal(false)

  useEffect(() => {
    return () => {
      if (spawnTimer.current) window.clearTimeout(spawnTimer.current)
      if (fallTimer.current) window.clearInterval(fallTimer.current)
    }
  }, [])

  const rearmAutoStart = useAutoStart(Boolean(gameRun.content) && gameRun.assetsReady, stage, () => void begin())

  function clearLoops() {
    if (spawnTimer.current) window.clearTimeout(spawnTimer.current)
    if (fallTimer.current) window.clearInterval(fallTimer.current)
    spawnTimer.current = undefined
    fallTimer.current = undefined
  }

  // Spawn cadence is dynamic (tightens with score), so it self-reschedules with
  // the current gap instead of a fixed interval. Stops when the run is no longer
  // live so a late timer never spawns onto a torn-down field.
  function scheduleSpawn() {
    if (spawnTimer.current) window.clearTimeout(spawnTimer.current)
    spawnTimer.current = window.setTimeout(() => {
      spawnDrop()
      if (stage.peek() === 'running') scheduleSpawn()
    }, rainSpawnIntervalMs(score.value))
  }

  // Show the running total for RAIN_MILESTONE_MS, then get out of the way. The
  // timer only clears the value it scheduled, so a later milestone landing inside
  // the window is never cut short by the previous one's timeout.
  function showMilestone(value: number) {
    milestone.value = value
    runtime.later(() => {
      if (milestone.peek() === value) milestone.value = null
    }, RAIN_MILESTONE_MS)
  }

  async function begin() {
    if (!(await gameRun.ensureFreshRun())) return
    lives.value = RAIN_LIVES
    score.value = 0
    milestone.value = null
    serverAnswers.current = []
    answersLog.current = []
    recorded.current = false
    runtime.start(() => {
      drops.current = []
      target.current = null
      rainSpd.current = 0
      cursor.current = 0
      scheduleSpawn()
      fallTimer.current = window.setInterval(tick, TICK_MS)
    })
  }

  // The falling-cards field only mounts on the 'running' render, which happens
  // *after* runtime.start()'s begin callback runs — so the eager first drop has
  // to wait for that mount, otherwise fieldRef is null and spawnDrop() no-ops
  // (leaving the field empty until the first scheduled spawn ~1160ms later). Clear
  // any prior run's tiles and deal the opening card as soon as the stage is live.
  // spawnDrop is reached through a ref so this only fires on the stage flip.
  const spawnRef = useRef<() => void>(() => {})
  spawnRef.current = spawnDrop
  useEffect(() => {
    if (stage.value !== 'running') return
    if (fieldRef.current) fieldRef.current.innerHTML = ''
    spawnRef.current()
  }, [stage.value])

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
    drops.current.push({
      el,
      card,
      y: -16,
      speed: RAIN_BASE_SPEED + Math.random() * RAIN_SPEED_JITTER + rainSpd.current,
      wrong: 0
    })
  }

  // Elapsed run time at the moment a card resolves. The clock starts when the
  // countdown ends (runtime.start), which is the same instant the first tile
  // spawns — so these stamps share an origin with the server's spawn floor.
  function atMs(): number {
    return Math.round(runtime.currentElapsed())
  }

  function recordResolved(d: Drop, guess: number | null): void {
    serverAnswers.current.push({ cardId: d.card.id, guess, atMs: atMs(), wrongGuesses: d.wrong })
    answersLog.current.push({ card: d.card, correct: guess !== null })
  }

  function tick() {
    if (stage.value !== 'running') return
    const survivors: Drop[] = []
    let lost = 0
    for (const d of drops.current) {
      d.y += d.speed
      if (d.y >= 96) {
        popTile(d, true)
        recordResolved(d, null)
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
    // Drop the gold "live target" ring as it leaves: a resolved tile lingers for
    // its exit animation, and a second lit tile on the field misreads as two
    // answerable cards.
    el.classList.remove('ed-rain__tile--lit')
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
      recordResolved(t, t.card.elixir)
      const next = score.value + 1
      score.value = next
      // Uncapped: both fall speed (here) and spawn cadence (rainSpawnIntervalMs,
      // read by the self-rescheduling spawn timer) keep ramping with every clear.
      rainSpd.current = rainFallBoost(next)
      if (next % RAIN_MILESTONE_EVERY === 0) showMilestone(next)
      hint.value = null
      playRainClear()
    } else {
      // A wrong tap does not resolve the card — it stays and keeps falling. Nudge
      // the player toward the right cost, and count the miss against this card:
      // fewest wrong guesses is how the board separates equal scores.
      if (t.wrong < MAX_WRONG_PER_CARD) t.wrong += 1
      hint.value = value < t.card.elixir ? 'higher' : 'lower'
      hintPulse.value += 1
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
    const prev = comparableBest(getRecords().rainBest)
    const pb = score.value > (prev ?? 0)
    prevBest.value = prev
    isPB.value = pb
    insights.value = computeInsights(
      answersLog.current.map((a) => ({ card: a.card, guess: a.correct ? a.card.elixir : 0, correct: a.correct }))
    )
    runtime.finish('over')
    // Record the ranked run on the server (guest → scored, not persisted). The
    // local rainBest is written centrally, and ONLY when the server accepts the
    // run (see recordAllTimeBest) — writing it here would leave a rejected run
    // showing as a personal best on this device.
    void gameRun.complete({ answers: serverAnswers.current })
  }

  function replay() {
    track('game.replayed', 'rain')
    clearLoops()
    rearmAutoStart()
    insights.value = null
    runtime.reset('ready')
    void gameRun.prepare()
  }

  if (!gameRun.content) return <GameRunGate session={gameRun} />

  // ── Summary ───────────────────────────────────────────────────────────────
  if (stage.value === 'over' && insights.value) {
    const callout = pbCallout(isPB.value, prevBest.value, {
      first: 'First Rain logged',
      improved: (previous) => `New best! +${score.value - previous}`,
      standing: (previous) => `Best: ${previous}`
    })
    return (
      <div class="ed-gamewrap">
        <Summary
          eyebrow="The rain stopped"
          headline={`${score.value} cleared`}
          pbCallout={callout}
          insights={insights.value}
          moments={[
            { label: 'Cleared', value: String(score.value) },
            { label: 'Prev best', value: String(prevBest.value ?? 0), tone: 'purple' },
            { label: 'Accuracy', value: `${insights.value.accuracyPct}%`, tone: 'green' }
          ]}
          share={{ mode: 'rain', score: `${score.value} cleared` }}
          onReplay={replay}
          replayLabel="Play again"
          onHome={() => navigate('/')}
        />
      </div>
    )
  }

  // ── Loading (pre-countdown) ───────────────────────────────────────────────
  if (stage.value === 'ready') return <GameLoading />

  const counting = stage.value !== 'running'
  // Lives use the shared row, so Rain and Higher/Lower are literally the same
  // component rather than two copies that agree today.
  const hearts = <LivesRow lives={lives.value} max={RAIN_LIVES} testId="rain-lives" />

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
        {milestone.value !== null && <RainMilestone key={milestone.value} value={milestone.value} />}
        <div class="ed-rain__cue" aria-hidden="true">
          <FloatingCue trigger={hintPulse.value} className="floating-cue--hint" testId="rain-hint">
            {hint.value === 'higher' && (
              <>
                <Icon name="arrow-up" /> Higher
              </>
            )}
            {hint.value === 'lower' && (
              <>
                <Icon name="arrow-down" /> Lower
              </>
            )}
          </FloatingCue>
        </div>
        <div class="ed-rain__pad">
          <PipKeypad onPick={answer} disabled={counting} />
        </div>
        <span class="sr-only" aria-live="assertive">
          {hint.value === 'higher' ? 'Higher' : hint.value === 'lower' ? 'Lower' : ''}
        </span>
      </div>
    </GameFrame>
  )
}
