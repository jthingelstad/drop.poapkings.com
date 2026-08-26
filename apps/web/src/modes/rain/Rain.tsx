import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { animate } from 'motion'
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
import SignaturePanel from '../../components/summary/SignaturePanel'
import { rainSignature, type Signature } from '../../lib/signatures'
import GameRunGate from '../../components/GameRunGate'
import GameFrame from '../../components/game/GameFrame'
import GameStartScreen from '../../components/game/GameStart'
import FloatingCue from '../../components/FloatingCue'
import Icon from '../../components/Icon'
import LivesRow from '../../components/LivesRow'
import GameMilestone from '../../components/GameMilestone'
import { preloadImages } from '../../lib/preload'
import { runInputEvidence, type InputObservation, type RunInputEvidence } from '../../lib/input-evidence'
import {
  RAIN_FRAGMENT_CLIP_PATHS,
  rainFallBoost,
  rainFallProgress,
  rainFallTimeLeftMs,
  rainFallTotalDurationMs,
  rainTileTopPx
} from './rain-physics'

// Rain — cards fall; clear the lit (lowest) card's cost before it lands. Three
// lives. RANKED: tiles are drawn in order from the server's signed deck (wrapping
// when it runs out — Rain is endless), and each RESOLVED card (cleared →
// guess=cost, landed → guess=null) is recorded in the transcript the server
// scores, stamped with the elapsed time at resolution and the wrong taps it cost.
//
// Difficulty scales with cleared count (demonstrated skill) on BOTH axes: cards
// fall faster and spawn closer together. The ramp has a shoulder at 80 clears;
// beyond it, every two clears advance difficulty by one step. Both curves key
// off the live score, so struggling is self-forgiving and the mode remains
// endless without putting its deepest play behind an abrupt wall.
const MAX_CONCURRENT = 8
const TICK_MS = 40
const RAIN_LIVES = 3
const COUNTDOWN_STEP_MS = 700
const RAIN_LOGICAL_TRAVEL = 112
const RAIN_FRAGMENT_DURATION_MS = 480

// Fall speed = RAIN_BASE_SPEED + per-drop jitter + rainFallBoost(score), in field
// %-per-tick. A card falls 112 units, so time ≈ 4480ms / speed. At score 0 that
// is ~9–12s before the final-10% slowdown adds 10% to the full fall. The
// linear+quadratic boost has no ceiling, while its post-80 progression is half.
//
// This axis stays local on purpose: the jitter makes it non-deterministic, so it
// can play no part in the server's minimum-time floor. The SPAWN axis is shared —
// `rainSpawnIntervalMs` comes from packages/contracts, which is what the scorer
// computes that floor from.
const RAIN_BASE_SPEED = 0.36
const RAIN_SPEED_JITTER = 0.14
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
  spawnedAt: number
  linearDurationMs: number
  progress: number
  topPx: number
  // Wrong taps spent on this card so far; rides into the transcript when it
  // resolves and feeds the leaderboard's first tiebreak.
  wrong: number
  inputRound: number
  inputEnabledAt: number
  // The moment this tile became answerable, and how long it had left to fall at
  // that moment. Both are computed every tick already; the summary chart simply
  // needs them kept per card, because the reference tick IS the time the card
  // had left. Without them Rain's chart cannot be drawn to scale.
  answerableAt: number
  windowMs: number
  targeted: boolean
}

export default function Rain() {
  const gameRun = useGameSession('rain', challengePreparers.rain)
  const runtime = useGameRuntime({ countdownStepMs: COUNTDOWN_STEP_MS, trackElapsed: false })
  const { stage, count } = runtime
  const fieldRef = useRef<HTMLDivElement>(null)
  const killLineRef = useRef<HTMLDivElement>(null)

  // Motion owns the impact feedback. Reduced motion keeps the exact same
  // deadline and collision rule, but removes the flash and fragments.
  function flashKillLine() {
    const el = killLineRef.current
    if (!el || isReducedMotionEnabled()) return
    void animate(el, { filter: ['brightness(2.6)', 'brightness(1)'] }, { duration: 0.12, ease: 'easeOut' })
  }
  const drops = useRef<Drop[]>([])
  const target = useRef<Drop | null>(null)
  const rainSpd = useRef(0)
  const cursor = useRef(0)
  const spawnTimer = useRef<number | undefined>(undefined)
  const fallTimer = useRef<number | undefined>(undefined)
  const spawnGeneration = useRef(0)
  // Server transcript: one entry per resolved card, in resolution order, each
  // stamped with the elapsed time at resolution. `atMs` is what lets the scorer
  // check the run against the shared spawn curve (a tile cannot be answered
  // before it can spawn) and derive the clear-latency tiebreak.
  const serverAnswers = useRef<
    Array<{ cardId: number; guess: number | null; atMs: number; wrongGuesses: number; inputRound: number }>
  >([])
  const inputEvents = useRef<RunInputEvidence[]>([])
  const runStartedAt = useRef(0)
  const nextInputRound = useRef(0)
  // Display insights (accuracy by cost) for the summary.
  const answersLog = useRef<Array<{ card: Card; correct: boolean }>>([])
  // One entry per resolved card for the summary chart: how long the read took
  // against how long the card had left when it became answerable.
  const reads = useRef<Array<{ answerMs: number; windowMs: number; lost: boolean }>>([])
  const recorded = useRef(false)

  const lives = useSignal(RAIN_LIVES)
  const score = useSignal(0)
  // The runtime intentionally holds the final frame for 200ms before showing
  // the summary. Stage remains `running` during that beat, so input needs its
  // own synchronous terminal lock: otherwise a tap after the third miss can be
  // appended to the signed transcript and the strict server rejects the run.
  const inputLocked = useSignal(false)
  // Directional hint after a wrong tap (like Surge): aim higher or lower.
  const hint = useSignal<'higher' | 'lower' | null>(null)
  const hintPulse = useSignal(0)
  // Every-10-clears progress flash in the middle of the field (null = nothing showing).
  const milestone = useSignal<number | null>(null)
  const insights = useSignal<Insights | null>(null)
  const signature = useSignal<Signature | null>(null)
  // The record standing BEFORE this run — the number the summary compares
  // against. Never overwritten with the score just set.
  const prevBest = useSignal(comparableBest(getRecords().rainBest))
  const isPB = useSignal(false)

  useEffect(() => {
    return () => {
      spawnGeneration.current += 1
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
      spawnDrop(() => {
        if (stage.peek() === 'running') scheduleSpawn()
      })
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
    inputLocked.value = false
    serverAnswers.current = []
    inputEvents.current = []
    nextInputRound.current = 0
    answersLog.current = []
    reads.current = []
    recorded.current = false
    runtime.start((startedAt) => {
      runStartedAt.current = startedAt
      spawnGeneration.current += 1
      drops.current = []
      target.current = null
      rainSpd.current = 0
      cursor.current = 0
      fallTimer.current = window.setInterval(tick, TICK_MS)
    })
  }

  // The falling-cards field only mounts on the 'running' render, which happens
  // *after* runtime.start()'s begin callback runs — so the eager first drop has
  // to wait for that mount, otherwise fieldRef is null and spawnDrop() no-ops
  // (leaving the field empty until the first scheduled spawn ~1160ms later). Clear
  // any prior run's tiles and deal the opening card as soon as the stage is live.
  // spawnDrop is reached through a ref so this only fires on the stage flip.
  const spawnRef = useRef<(onSpawned?: () => void) => void>(() => {})
  const scheduleSpawnRef = useRef<() => void>(() => {})
  spawnRef.current = spawnDrop
  scheduleSpawnRef.current = scheduleSpawn
  useEffect(() => {
    if (stage.value !== 'running') return
    if (fieldRef.current) fieldRef.current.innerHTML = ''
    spawnRef.current(scheduleSpawnRef.current)
  }, [stage.value])

  function nextCard(): Card | null {
    const deck = gameRun.content
    if (!deck || deck.length === 0) return null
    const c = deck[cursor.current % deck.length]!
    cursor.current += 1
    return c
  }

  function spawnDrop(onSpawned: () => void = () => {}) {
    const field = fieldRef.current
    if (!field || drops.current.length > MAX_CONCURRENT) {
      onSpawned()
      return
    }
    const card = nextCard()
    if (!card) {
      onSpawned()
      return
    }
    const generation = spawnGeneration.current
    // A Rain tile enters the timed field only after its exact art has decoded.
    // Chaining the next spawn from this callback preserves signed deck order;
    // two slow decodes can never race and put later cards onto the field first.
    preloadImages([card], () => {
      if (generation !== spawnGeneration.current || stage.peek() !== 'running' || !field.isConnected) return
      const el = document.createElement('div')
      el.className = 'ed-rain__tile'
      el.style.left = `${6 + Math.random() * 72}%`
      el.innerHTML =
        `<img src="${card.icon}" alt="" class="ed-rain__tile-img" loading="eager" decoding="sync"/>` +
        `<span class="ed-rain__tile-name">${card.name}</span>`
      field.appendChild(el)
      // The original random pace remains, but it is converted to a monotonic
      // duration. Field height now affects only pixel travel, never answer time.
      // The spawn's two Math.random() reads remain position then speed.
      const speed = RAIN_BASE_SPEED + Math.random() * RAIN_SPEED_JITTER + rainSpd.current
      const spawnedAt = performance.now()
      const linearDurationMs = (RAIN_LOGICAL_TRAVEL / speed) * TICK_MS
      const drop: Drop = {
        el,
        card,
        spawnedAt,
        linearDurationMs,
        progress: 0,
        topPx: 0,
        wrong: 0,
        inputRound: nextInputRound.current++,
        inputEnabledAt: spawnedAt,
        answerableAt: spawnedAt,
        windowMs: rainFallTotalDurationMs(linearDurationMs),
        targeted: false
      }
      drops.current.push(drop)
      renderDrop(drop, spawnedAt)
      onSpawned()
    })
  }

  function renderDrop(d: Drop, now: number): number {
    const field = fieldRef.current
    if (!field) return d.progress
    const fieldBounds = field.getBoundingClientRect()
    const tileBounds = d.el.getBoundingClientRect()
    const killLineBounds = killLineRef.current?.getBoundingClientRect()
    const fieldHeight = fieldBounds.height || field.clientHeight || 500
    const tileHeight = tileBounds.height || d.el.offsetHeight || 100
    const killLineOffset = killLineBounds && fieldBounds.height > 0 ? killLineBounds.top - fieldBounds.top : fieldHeight

    d.progress = rainFallProgress(now - d.spawnedAt, d.linearDurationMs)
    d.topPx = rainTileTopPx(d.progress, tileHeight, killLineOffset)
    d.el.style.top = `${d.topPx}px`
    return d.progress
  }

  // Elapsed run time at the moment a card resolves. The clock starts when the
  // countdown ends (runtime.start), which is the same instant the first tile
  // spawns — so these stamps share an origin with the server's spawn floor.
  function atMs(): number {
    return Math.round(runtime.currentElapsed())
  }

  function recordResolved(d: Drop, guess: number | null): void {
    serverAnswers.current.push({
      cardId: d.card.id,
      guess,
      atMs: atMs(),
      wrongGuesses: d.wrong,
      inputRound: d.inputRound
    })
    answersLog.current.push({ card: d.card, correct: guess !== null })
    reads.current.push({
      answerMs: Math.max(0, Math.round(performance.now() - d.answerableAt)),
      windowMs: Math.round(d.windowMs),
      lost: guess === null
    })
  }

  function tick(now = performance.now()) {
    if (stage.value !== 'running' || inputLocked.value) return
    const survivors: Drop[] = []
    let lost = 0
    const remainingLives = Math.max(0, lives.value)
    for (const d of drops.current) {
      // Progress is clock-driven and therefore independent of field height or a
      // delayed interval callback. At 1, rainTileTopPx places the tile's bottom
      // edge on the top edge of the visible kill line.
      if (renderDrop(d, now) >= 1) {
        popTile(d, true)
        flashKillLine()
        // Several accelerated cards can reach the floor on the same 40ms
        // tick. Remove every landed tile from the field, but stop the signed
        // transcript exactly when the remaining lives are spent: recording a
        // fourth miss makes an honest run look as though it continued after
        // game over, which the server correctly rejects.
        if (lost < remainingLives) {
          recordResolved(d, null)
          lost++
        }
        continue
      }
      survivors.push(d)
    }
    drops.current = survivors
    // The card furthest through its device-independent fall is the live target.
    let t: Drop | null = null
    for (const d of drops.current) if (!t || d.progress > t.progress) t = d
    if (target.current !== t && t) {
      t.inputEnabledAt = now
      // A tile is only answerable while it is lit, so the read clock and the
      // fall it is racing both start here — once, the first time it lights up.
      if (!t.targeted) {
        t.targeted = true
        t.answerableAt = now
        t.windowMs = rainFallTimeLeftMs(now - t.spawnedAt, t.linearDurationMs)
      }
    }
    target.current = t
    for (const d of drops.current) d.el.classList.toggle('ed-rain__tile--lit', d === t)
    if (lost) {
      const next = lives.value - lost
      lives.value = next
      playRainMiss()
      if (next <= 0) endRain()
    }
  }

  function explodeTile(el: HTMLDivElement) {
    const field = fieldRef.current
    if (!field || isReducedMotionEnabled()) {
      el.remove()
      return
    }

    el.classList.remove('ed-rain__tile--lit', 'ed-rain__shake')
    RAIN_FRAGMENT_CLIP_PATHS.forEach((clipPath, index) => {
      const fragment = el.cloneNode(true) as HTMLDivElement
      fragment.className = 'ed-rain__tile ed-rain__tile--fragment'
      fragment.style.clipPath = clipPath
      field.appendChild(fragment)

      const direction = index % 2 === 0 ? -1 : 1
      const spreadX = direction * (26 + (index % 4) * 15)
      const liftY = -28 - (index % 3) * 16
      const settleY = 26 + (index % 4) * 10
      const rotation = direction * (18 + index * 11)
      const animation = animate(
        fragment,
        {
          opacity: [1, 1, 0],
          transform: [
            'translate3d(0, 0, 0) rotate(0deg) scale(1)',
            `translate3d(${spreadX * 0.7}px, ${liftY}px, 0) rotate(${rotation * 0.55}deg) scale(0.9)`,
            `translate3d(${spreadX}px, ${settleY}px, 0) rotate(${rotation}deg) scale(0.68)`
          ]
        },
        { duration: RAIN_FRAGMENT_DURATION_MS / 1000, ease: 'easeOut' }
      )
      void animation.finished.then(() => fragment.remove()).catch(() => fragment.remove())
      window.setTimeout(() => fragment.remove(), RAIN_FRAGMENT_DURATION_MS + 80)
    })
    el.remove()
  }

  function popTile(d: Drop, missed: boolean) {
    const el = d.el
    if (!el) return
    if (missed) {
      explodeTile(el)
      return
    }
    if (isReducedMotionEnabled()) {
      el.remove()
      return
    }
    // Drop the gold "live target" ring as it leaves: a resolved tile lingers for
    // its exit animation, and a second lit tile on the field misreads as two
    // answerable cards.
    el.classList.remove('ed-rain__tile--lit')
    el.classList.add('ed-rain__tile--clear')
    el.addEventListener('animationend', () => el.remove(), { once: true })
    window.setTimeout(() => el.remove(), 500)
  }

  function answer(value: number, observation: InputObservation) {
    if (stage.value !== 'running' || inputLocked.value) return
    // Settle any logical impact before accepting an input delivered between
    // interval callbacks. A busy device cannot turn delayed rendering into
    // extra answer time.
    tick(observation.inputAt)
    if (inputLocked.value) return
    const t = target.current
    if (!t) return
    const recordInput = value === t.card.elixir || t.wrong < MAX_WRONG_PER_CARD
    if (recordInput)
      inputEvents.current.push(
        runInputEvidence(observation, runStartedAt.current, t.inputEnabledAt, t.inputRound, value)
      )
    if (value === t.card.elixir) {
      popTile(t, false)
      drops.current = drops.current.filter((x) => x !== t)
      target.current = null
      recordResolved(t, t.card.elixir)
      const next = score.value + 1
      score.value = next
      // Both axes use the same shoulder: full-strength through 80 clears, then
      // half-strength forever with no cap.
      rainSpd.current = rainFallBoost(next)
      if (next % RAIN_MILESTONE_EVERY === 0) showMilestone(next)
      hint.value = null
      playRainClear()
    } else {
      // A wrong tap does not resolve the card — it stays and keeps falling. Nudge
      // the player toward the right cost, and count the miss against this card:
      // fewest wrong guesses is how the board separates equal scores.
      if (t.wrong < MAX_WRONG_PER_CARD) t.wrong += 1
      t.inputEnabledAt = observation.inputAt
      hint.value = value < t.card.elixir ? 'higher' : 'lower'
      hintPulse.value += 1
      t.el.classList.remove('ed-rain__shake')
      void t.el.offsetWidth
      t.el.classList.add('ed-rain__shake')
    }
  }

  function endRain() {
    if (inputLocked.value) return
    inputLocked.value = true
    spawnGeneration.current += 1
    target.current = null
    for (const d of drops.current) d.el.classList.remove('ed-rain__tile--lit')
    clearLoops()
    runtime.later(finish, RAIN_FRAGMENT_DURATION_MS)
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
    // Signature: seconds to answer against the seconds that card had left to
    // fall — one unit on both, so the bar and its tick can be compared at a
    // glance. A red bar is a life lost.
    if (reads.current.length > 0)
      signature.value = rainSignature(
        reads.current.map((r) => r.answerMs),
        reads.current.map((r) => r.windowMs),
        reads.current.map((r) => r.lost)
      )
    runtime.finish('over')
    // Record the ranked run on the server (guest → scored, not persisted). The
    // local rainBest is written centrally, and ONLY when the server accepts the
    // run (see recordAllTimeBest) — writing it here would leave a rejected run
    // showing as a personal best on this device.
    void gameRun.complete({ answers: serverAnswers.current, inputEvents: inputEvents.current })
  }

  function replay() {
    track('game.replayed', 'rain')
    clearLoops()
    spawnGeneration.current += 1
    inputLocked.value = false
    rearmAutoStart()
    insights.value = null
    runtime.reset('ready')
    void gameRun.prepare()
  }

  if (!gameRun.content) return <GameRunGate modeName="Rain" session={gameRun} />

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
          share={{
            mode: 'rain',
            score: `${score.value} cleared`
          }}
          onReplay={replay}
          replayLabel="Play again"
          onHome={() => navigate('/')}
        >
          {signature.value && <SignaturePanel {...signature.value} />}
        </Summary>
      </div>
    )
  }

  // ── Loading (pre-countdown) ───────────────────────────────────────────────
  if (stage.value === 'ready') return <GameStartScreen modeName="Rain" phase="loading" />

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
      fullBleed
    >
      <div class="ed-rain">
        <div ref={fieldRef} class="ed-rain__field" aria-hidden="true" />
        <div ref={killLineRef} class="ed-rain__killline" aria-hidden="true" />
        {milestone.value !== null && <GameMilestone key={milestone.value} value={milestone.value} />}
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
          <PipKeypad onPick={answer} disabled={counting || inputLocked.value} />
        </div>
        <span class="sr-only" aria-live="assertive">
          {hint.value === 'higher' ? 'Higher' : hint.value === 'lower' ? 'Lower' : ''}
        </span>
      </div>
    </GameFrame>
  )
}
