import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { survivalWindowMs } from '@elixir-drop/contracts'
import type { Card } from '../../types'
import type { Answer, Insights } from '../../lib/insights'
import { saveResult, getRecords } from '../../lib/storage'
import { computeInsights } from '../../lib/insights'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import { createProgressivePreloadPlan, preloadImages } from '../../lib/preload'
import { formatSeconds } from '../../lib/format'
import { comparableBest, pbCallout } from '../../lib/pb-callout'
import { useAutoStart } from '../../lib/use-auto-start'
import { useEndRunOnHide, useShrinkingWindow } from '../../lib/use-round-clock'
import { useGameRuntime } from '../../lib/use-game-runtime'
import CardDisplay from '../../components/CardDisplay'
import PipKeypad from '../../components/PipKeypad'
import Summary from '../../components/Summary'
import SignaturePanel from '../../components/summary/SignaturePanel'
import { survivalSignature, type Signature } from '../../lib/signatures'
import GameRunGate from '../../components/GameRunGate'
import GameMotion from '../../components/GameMotion'
import GameFrame from '../../components/game/GameFrame'
import GameStartScreen from '../../components/game/GameStart'
import GameMilestone from '../../components/GameMilestone'
import { preloadGameFx } from '../../components/GameFxLayer'
import { challengePreparers } from '../../lib/game-challenge-content'
import { useGameSession } from '../../lib/use-game-session'
import { runInputEvidence, type InputObservation, type RunInputEvidence } from '../../lib/input-evidence'

// Survival = sudden death. Each card has a short clock that tightens as the
// streak grows (shared curve with the server scorer); a miss OR a timeout ends
// the run. Score is how many you clear in a row.
const DEATH_BEAT_MS = 1100
// A 3-2-1 before the first card so the per-card clock never starts while the
// player is still orienting — the sudden-death clock only begins once counting
// ends. Matches Surge's cadence.
const COUNTDOWN_STEP_MS = 700
// The signed deck is the whole catalog. Gate startup on only this first slice,
// then keep the same number of future cards warm as the player advances.
const STARTUP_ART_COUNT = 14
const ART_LOOKAHEAD = 14
const MILESTONE_EVERY = 10
const MILESTONE_MS = 500

export default function Survival() {
  const gameRun = useGameSession('survival', challengePreparers.survival)
  const answers = useRef<Answer[]>([])
  const cardStart = useRef(0)
  const runStartedAt = useRef(0)
  const dead = useRef(false)
  const serverCardIndex = useRef(0)
  const serverAnswers = useRef<Array<{ cardId: number; guess: number | null; elapsedMs: number }>>([])
  // The response window that was actually running for each card, kept per answer
  // rather than only for the run's final value. The chart's reference tick IS
  // that window, so without this the bars have nothing to be read against.
  const reads = useRef<Array<{ ms: number; windowMs: number }>>([])
  const inputEvents = useRef<RunInputEvidence[]>([])
  const preloadContent = useRef<Card[] | null>(null)
  const progressiveArt = useRef<ReturnType<typeof createProgressivePreloadPlan> | null>(null)
  const handoffGeneration = useRef(0)

  const runtime = useGameRuntime({ countdownStepMs: COUNTDOWN_STEP_MS })
  const { stage, count, later } = runtime
  const streak = useSignal(0)
  const signature = useSignal<Signature | null>(null)
  const milestone = useSignal<number | null>(null)
  // The record standing BEFORE this run — the number the summary compares
  // against. Never overwritten with the streak just set.
  const prevBest = useSignal(comparableBest(getRecords().survivalBest))
  const remainingFrac = useSignal(1)
  const current = useSignal<Card | null>(null)
  const cardPhase = useSignal<'playing' | 'correct' | 'wrong'>('playing')

  const insights = useSignal<Insights | null>(null)
  const isPB = useSignal(false)
  // Set when the whole deck is cleared — a win, not a death.
  const won = useRef(false)
  const finishTimeMs = useSignal(0)
  const dieRef = useRef<(card: Card | null, picked: number | undefined) => void>(() => {})
  dieRef.current = die

  useEffect(() => {
    preloadGameFx()
    return () => {
      handoffGeneration.current += 1
    }
  }, [])

  const rearmAutoStart = useAutoStart(Boolean(gameRun.content) && gameRun.assetsReady, stage, () => void begin())

  // Sudden death cannot pause — leaving the tab ends the run with the streak
  // intact rather than letting the clock burn while hidden.
  useEndRunOnHide(stage.value === 'running', () => dieRef.current(current.value, undefined))

  // Per-card clock — drives the depleting bar and times you out. The window
  // shrinks as the streak grows, so deep runs end at the player's true speed
  // ceiling instead of by boredom or a lapse.
  useShrinkingWindow({
    running: stage.value === 'running',
    ticking: () => cardPhase.value === 'playing',
    startedAt: cardStart,
    windowMs: () => survivalWindowMs(streak.value),
    remaining: remainingFrac,
    onExpire: () => dieRef.current(current.value, undefined)
  })

  function warmCardArt(activeIndex: number) {
    const content = gameRun.content
    if (!content) return
    if (preloadContent.current !== content) {
      preloadContent.current = content
      progressiveArt.current = createProgressivePreloadPlan(content, STARTUP_ART_COUNT, ART_LOOKAHEAD)
    }
    const nextBatch = progressiveArt.current?.next(activeIndex) ?? []
    if (nextBatch.length > 0) preloadImages(nextBatch, () => {})
  }

  function showMilestone(value: number) {
    milestone.value = value
    later(() => {
      if (milestone.peek() === value) milestone.value = null
    }, MILESTONE_MS)
  }

  async function begin() {
    if (!(await gameRun.ensureFreshRun())) return
    // Top up the first card's look-ahead before the countdown begins. From
    // here on, each advance adds one distant card instead of loading the whole
    // catalog or waiting until that card is already against the clock.
    warmCardArt(0)
    runtime.start((startedAt) => {
      runStartedAt.current = startedAt
      dead.current = false
      won.current = false
      answers.current = []
      serverAnswers.current = []
      reads.current = []
      inputEvents.current = []
      streak.value = 0
      milestone.value = null
      current.value = gameRun.content?.[0] ?? null
      serverCardIndex.current = current.value ? 1 : 0
      cardStart.current = startedAt
      remainingFrac.value = 1
      cardPhase.value = 'playing'
    })
  }

  function nextCard() {
    if (stage.value !== 'running' || dead.current) return
    const nextIndex = serverCardIndex.current
    const c = gameRun.content?.[nextIndex]
    if (!c) {
      // Cleared the whole deck — a win.
      won.current = true
      finish()
      return
    }
    warmCardArt(nextIndex)
    const generation = ++handoffGeneration.current
    // Look-ahead normally makes this an immediate cache/decode hit, but the
    // active-card gate is the guarantee: the sudden-death clock and new hand do
    // not start until this exact card is paint-ready.
    preloadImages([c], () => {
      if (generation !== handoffGeneration.current || stage.value !== 'running' || dead.current) return
      serverCardIndex.current += 1
      current.value = c
      cardStart.current = performance.now()
      remainingFrac.value = 1
      cardPhase.value = 'playing'
      runtime.emitCue('round-advance', { cardId: c.id })
    })
  }

  // death by a wrong guess (picked set) or a timeout (picked undefined)
  function die(card: Card | null, picked: number | undefined, observation?: InputObservation) {
    if (dead.current) return
    dead.current = true
    handoffGeneration.current += 1
    playWrong()
    if (card) {
      if (picked !== undefined && observation) {
        inputEvents.current.push(
          runInputEvidence(observation, runStartedAt.current, cardStart.current, streak.value, picked)
        )
      }
      const fatalMs = performance.now() - cardStart.current
      serverAnswers.current.push({ cardId: card.id, guess: picked ?? null, elapsedMs: fatalMs })
      reads.current.push({ ms: Math.round(fatalMs), windowMs: survivalWindowMs(streak.value) })
      answers.current.push({ card, guess: picked ?? card.elixir, correct: false })
      saveResult(card.id, false)
    }
    cardPhase.value = 'wrong'
    remainingFrac.value = 0
    runtime.emitCue('answer-wrong', { cardId: card?.id, timeout: picked === undefined })
    later(finish, DEATH_BEAT_MS)
  }

  function finish() {
    const ins = computeInsights(answers.current)
    const prev = comparableBest(getRecords().survivalBest)

    insights.value = ins
    // Read the standing record BEFORE the server writes this run's, so the
    // summary's "Prev best" is the mark that was actually beaten.
    prevBest.value = prev
    isPB.value = streak.value > (prev ?? 0)
    // Cumulative time across the surviving cards — matches the server's tiebreak.
    finishTimeMs.value = serverAnswers.current.slice(0, streak.value).reduce((sum, entry) => sum + entry.elapsedMs, 0)
    // Signature: seconds to answer against the window that was actually running
    // at that streak. They converge, and the run ends where they meet — so the
    // one red bar is the card that ended it, and a deck clear has none.
    signature.value = survivalSignature(
      reads.current.map((r) => r.ms),
      reads.current.map((r) => r.windowMs),
      won.current ? -1 : reads.current.length - 1
    )
    // survivalBest is persisted centrally when the server accepts the run.
    runtime.finish('over')
    void gameRun.complete({ answers: serverAnswers.current, inputEvents: inputEvents.current })
  }

  function answer(picked: number, observation: InputObservation) {
    if (stage.value !== 'running' || cardPhase.value !== 'playing' || dead.current) return
    const card = current.value
    if (!card) return

    if (picked === card.elixir) {
      inputEvents.current.push(
        runInputEvidence(observation, runStartedAt.current, cardStart.current, streak.value, picked)
      )
      playCorrect()
      const ms = performance.now() - cardStart.current
      serverAnswers.current.push({ cardId: card.id, guess: picked, elapsedMs: ms })
      reads.current.push({ ms: Math.round(ms), windowMs: survivalWindowMs(streak.value) })
      answers.current.push({ card, guess: picked, correct: true, ms })
      saveResult(card.id, true, ms)
      streak.value += 1
      if (streak.value % MILESTONE_EVERY === 0) showMilestone(streak.value)
      cardPhase.value = 'correct'
      runtime.emitCue('answer-correct', { cardId: card.id })
      later(nextCard, 230)
    } else {
      die(card, picked, observation)
    }
  }

  function replay() {
    track('game.replayed', 'survival')
    runtime.reset('ready')
    dead.current = false
    rearmAutoStart()
    won.current = false
    insights.value = null
    current.value = null
    serverCardIndex.current = 0
    serverAnswers.current = []
    reads.current = []
    inputEvents.current = []
    cardPhase.value = 'playing'
    streak.value = 0
    milestone.value = null
    remainingFrac.value = 1
    handoffGeneration.current += 1
    void gameRun.prepare()
  }

  // ── Game over ──────────────────────────────────────────────────────────────
  if (!gameRun.content) return <GameRunGate modeName="Survival" session={gameRun} />

  if (stage.value === 'over' && insights.value) {
    const winTime = `${formatSeconds(finishTimeMs.value)}s`
    // Clearing the deck is a win, not a streak comparison — it outranks the
    // usual best/first/standing chain.
    const callout = won.current
      ? `Cleared in ${winTime}`
      : pbCallout(isPB.value, prevBest.value, {
          // Survival reports no delta: the streak tile already carries it.
          first: 'New personal best!',
          improved: () => 'New personal best!',
          standing: (previous) => `Best: ${previous}`
        })
    return (
      <div class="ed-gamewrap">
        <Summary
          eyebrow={won.current ? 'Survival · cleared!' : 'Sudden death'}
          headline={won.current ? 'Every card named!' : `${streak.value} streak`}
          pbCallout={callout}
          insights={insights.value}
          moments={[
            { label: 'Streak', value: String(streak.value) },
            { label: 'Prev best', value: String(prevBest.value ?? 0), tone: 'purple' },
            {
              label: won.current ? 'Time' : 'Accuracy',
              value: won.current ? winTime : `${insights.value.accuracyPct}%`,
              tone: 'green'
            }
          ]}
          share={{
            mode: 'survival',
            score: won.current ? `${streak.value} streak · cleared in ${winTime}` : `${streak.value} streak`
          }}
          onReplay={replay}
          onHome={() => navigate('/')}
        >
          {signature.value && <SignaturePanel {...signature.value} />}
        </Summary>
      </div>
    )
  }

  // ── Loading (pre-countdown) ───────────────────────────────────────────────
  if (stage.value === 'ready') return <GameStartScreen modeName="Survival" phase="loading" />

  // ── Countdown + Running ──────────────────────────────────────────────────
  const counting = stage.value === 'countdown'
  const card = counting ? gameRun.content[0]! : current.value
  const low = remainingFrac.value <= 0.35
  // Progress through the deck is the endgame — fastest to the whole deck wins —
  // so the top bar fills toward it, not the per-card clock. That clock now lives
  // between the card and the keypad, where it cannot be mistaken for score.
  const deckSize = gameRun.content.length
  return (
    <GameFrame
      modeName="Survival"
      counting={counting}
      count={count.value}
      onQuit={() => navigate('/')}
      cue={runtime.cue.value}
      fxParticles={10}
      progressText={`${streak.value} / ${deckSize}`}
      metric={{ value: String(streak.value), label: 'streak' }}
      progressPct={(streak.value / deckSize) * 100}
    >
      <div class="ed-kstage">
        <div class="ed-kstage__card">
          {card && (
            <GameMotion contentKey={card.id} cue={runtime.cue.value}>
              <CardDisplay card={card} phase={cardPhase.value} revealCost={cardPhase.value === 'wrong'} />
            </GameMotion>
          )}
        </div>
        {/* The only thing that can kill you, in the gap it can be read from: a
            12px response clock between the card and the keys. Red as it runs out. */}
        <div class={`ed-response-clock${low ? ' ed-response-clock--low' : ''}`} aria-hidden="true">
          <div class="ed-response-clock__fill" style={{ width: `${Math.max(0, remainingFrac.value * 100)}%` }} />
        </div>
        <PipKeypad onPick={answer} disabled={cardPhase.value !== 'playing'} />
        {milestone.value !== null && <GameMilestone key={milestone.value} value={milestone.value} />}
      </div>
    </GameFrame>
  )
}
