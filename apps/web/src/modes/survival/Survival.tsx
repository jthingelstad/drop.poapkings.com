import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { survivalWindowMs } from '@elixir-drop/contracts'
import type { Card } from '../../types'
import type { Answer, Insights } from '../../lib/insights'
import { pointerVerb } from '../../lib/use-layout'
import { saveResult, getRecords } from '../../lib/storage'
import { computeInsights } from '../../lib/insights'
import { track } from '../../lib/analytics'
import { playCorrect, playWrong } from '../../lib/sound'
import { navigate } from '../../lib/router'
import { preloadImages } from '../../lib/preload'
import { useGameRuntime } from '../../lib/use-game-runtime'
import CardDisplay from '../../components/CardDisplay'
import FloatingCue from '../../components/FloatingCue'
import PipKeypad from '../../components/PipKeypad'
import Summary from '../../components/Summary'
import GameRunGate from '../../components/GameRunGate'
import GameMotion from '../../components/GameMotion'
import GameFrame from '../../components/game/GameFrame'
import { preloadGameFx } from '../../components/GameFxLayer'
import { challengePreparers } from '../../lib/game-challenge-content'
import { useGameSession } from '../../lib/use-game-session'

// Survival = sudden death. Each card has a short clock that tightens as the
// streak grows (shared curve with the server scorer); a miss OR a timeout ends
// the run. Score is how many you clear in a row.
const DEATH_BEAT_MS = 1100
// A 3-2-1 before the first card so the per-card clock never starts while the
// player is still orienting — the sudden-death clock only begins once counting
// ends. Matches Surge's cadence.
const COUNTDOWN_STEP_MS = 650

export default function Survival() {
  const gameRun = useGameSession('survival', challengePreparers.survival)
  const answers = useRef<Answer[]>([])
  const cardStart = useRef(0)
  const dead = useRef(false)
  const started = useRef(false)
  const serverCardIndex = useRef(0)
  const serverAnswers = useRef<Array<{ cardId: number; guess: number | null; elapsedMs: number }>>([])

  const runtime = useGameRuntime({ countdownStepMs: COUNTDOWN_STEP_MS })
  const { stage, count, later } = runtime
  const streak = useSignal(0)
  const streakCue = useSignal(0)
  const best = useSignal(getRecords().survivalBest ?? 0)
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
  }, [])

  // Play → countdown (no manual ready screen). Auto-start once loaded; re-arms on
  // replay. begin() is reached via a ref so this only re-fires on load state.
  const beginRef = useRef<() => void>(() => {})
  beginRef.current = begin
  useEffect(() => {
    if (gameRun.content && gameRun.assetsReady && !started.current && stage.peek() === 'ready') {
      started.current = true
      beginRef.current()
    }
  }, [gameRun.content, gameRun.assetsReady, stage])

  // Sudden death cannot pause (that would be free thinking time), so leaving
  // the tab ends the run right away with the streak intact — instead of the
  // old behavior where the clock kept running while hidden and the first
  // frame after returning executed the death.
  useEffect(() => {
    if (stage.value !== 'running') return
    const onHidden = () => {
      if (document.visibilityState === 'hidden') dieRef.current(current.value, undefined)
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => document.removeEventListener('visibilitychange', onHidden)
  }, [current, stage.value])

  // Per-card clock — drives the depleting bar and times you out. The window
  // shrinks as the streak grows, so deep runs end at the player's true speed
  // ceiling instead of by boredom or a lapse.
  useEffect(() => {
    if (stage.value !== 'running') return
    let raf = 0
    const loop = () => {
      if (cardPhase.value === 'playing') {
        const elapsed = performance.now() - cardStart.current
        const frac = 1 - elapsed / survivalWindowMs(streak.value)
        remainingFrac.value = Math.max(0, frac)
        if (frac <= 0) {
          dieRef.current(current.value, undefined)
          return
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [cardPhase, current, remainingFrac, stage.value, streak])

  async function begin() {
    if (!(await gameRun.ensureFreshRun())) return
    runtime.start((startedAt) => {
      dead.current = false
      won.current = false
      answers.current = []
      serverAnswers.current = []
      streak.value = 0
      current.value = gameRun.content?.[0] ?? null
      serverCardIndex.current = current.value ? 1 : 0
      cardStart.current = startedAt
      remainingFrac.value = 1
      cardPhase.value = 'playing'
    })
  }

  function nextCard() {
    if (stage.value !== 'running' || dead.current) return
    const c = gameRun.content?.[serverCardIndex.current]
    if (!c) {
      // Cleared the whole deck — a win.
      won.current = true
      finish()
      return
    }
    serverCardIndex.current += 1
    current.value = c
    cardStart.current = performance.now()
    remainingFrac.value = 1
    cardPhase.value = 'playing'
    preloadImages([c], () => {})
    runtime.emitCue('round-advance', { cardId: c.id })
  }

  // death by a wrong guess (picked set) or a timeout (picked undefined)
  function die(card: Card | null, picked: number | undefined) {
    if (dead.current) return
    dead.current = true
    playWrong()
    if (card) {
      serverAnswers.current.push({
        cardId: card.id,
        guess: picked ?? null,
        elapsedMs: performance.now() - cardStart.current
      })
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
    const prev = getRecords().survivalBest
    const pb = streak.value > (prev ?? 0)

    insights.value = ins
    isPB.value = pb
    // Cumulative time across the surviving cards — matches the server's tiebreak.
    finishTimeMs.value = serverAnswers.current.slice(0, streak.value).reduce((sum, entry) => sum + entry.elapsedMs, 0)
    if (pb) {
      // Live display only; survivalBest is persisted centrally on acceptance.
      best.value = streak.value
    }
    runtime.finish('over')
    void gameRun.complete({ answers: serverAnswers.current })
  }

  function answer(picked: number) {
    if (stage.value !== 'running' || cardPhase.value !== 'playing' || dead.current) return
    const card = current.value
    if (!card) return

    if (picked === card.elixir) {
      playCorrect()
      const ms = performance.now() - cardStart.current
      serverAnswers.current.push({ cardId: card.id, guess: picked, elapsedMs: ms })
      answers.current.push({ card, guess: picked, correct: true, ms })
      saveResult(card.id, true, ms)
      streak.value += 1
      if (streak.value === 3 || (streak.value > 3 && streak.value % 5 === 0)) streakCue.value += 1
      cardPhase.value = 'correct'
      runtime.emitCue('answer-correct', { cardId: card.id })
      later(nextCard, 230)
    } else {
      die(card, picked)
    }
  }

  function replay() {
    track('game.replayed', 'survival')
    runtime.reset('ready')
    dead.current = false
    started.current = false
    won.current = false
    insights.value = null
    current.value = null
    serverCardIndex.current = 0
    serverAnswers.current = []
    cardPhase.value = 'playing'
    streak.value = 0
    remainingFrac.value = 1
    void gameRun.prepare()
  }

  // ── Game over ──────────────────────────────────────────────────────────────
  if (!gameRun.content) {
    return (
      <GameRunGate preparing={gameRun.preparing.value} error={gameRun.error} onRetry={() => void gameRun.prepare()} />
    )
  }

  if (stage.value === 'over' && insights.value) {
    const winTime = `${(finishTimeMs.value / 1000).toFixed(2)}s`
    const pbCallout = won.current
      ? `Cleared in ${winTime}`
      : isPB.value
        ? 'New personal best!'
        : best.value > 0
          ? `Best: ${best.value}`
          : undefined
    return (
      <div class="ed-gamewrap">
        <Summary
          eyebrow={won.current ? 'Survival · cleared!' : 'Sudden death'}
          headline={won.current ? 'Every card named!' : `${streak.value} streak`}
          pbCallout={pbCallout}
          insights={insights.value}
          moments={[
            { label: 'Streak', value: String(streak.value) },
            { label: 'Prev best', value: String(best.value), tone: 'purple' },
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

  // ── Countdown + Running ──────────────────────────────────────────────────
  const counting = stage.value === 'countdown'
  const card = counting ? gameRun.content[0]! : current.value
  const low = remainingFrac.value <= 0.35
  return (
    <GameFrame
      modeName="Survival"
      counting={counting}
      count={count.value}
      onQuit={() => navigate('/')}
      cue={runtime.cue.value}
      fxParticles={10}
      progressText="Sudden death"
      metric={{ value: String(streak.value), label: 'streak' }}
      progressPct={remainingFrac.value * 100}
      barTransition={false}
      barLow={low}
    >
      <div class="ed-kstage">
        <div class="ed-kstage__card">
          {card && (
            <GameMotion contentKey={card.id} cue={runtime.cue.value}>
              <CardDisplay card={card} phase={cardPhase.value} revealCost={cardPhase.value === 'wrong'} />
            </GameMotion>
          )}
        </div>
        <div class="ed-kstage__hint">{pointerVerb()} the elixir cost</div>
        <PipKeypad onPick={answer} disabled={cardPhase.value !== 'playing'} />

        {/* Shared floating streak cue — composited, never in layout flow. */}
        <div class="game-cues" aria-hidden="true">
          <div class="game-cues__slot game-cues__slot--top">
            <FloatingCue trigger={streakCue.value} className="floating-cue--streak">
              🔥 {streak.value} streak
            </FloatingCue>
          </div>
        </div>
      </div>
    </GameFrame>
  )
}
